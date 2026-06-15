import { prisma } from '../prisma';
import { ErrorCodes, forbidden, notFound } from '../errors';

export type ClientIdentityAuditEntry = {
  id: string;
  action: 'USER_CLIENT_LINK' | 'USER_CLIENT_UNLINK' | 'CLIENTS_MERGED' | string;
  kind:
    | 'already_linked'
    | 'created_client'
    | 'manual_link'
    | 'self_claim'
    | 'incident_link'
    | 'booking_link'
    | 'unlink'
    | 'merge_manual'
    | 'merge_incident'
    | 'unknown';
  kindLabel: string;
  sourceLabel: string | null;
  summary: string;
  createdAt: Date;
  actorUser: {
    id: number;
    displayName: string;
    email: string | null;
  } | null;
  payload: Record<string, any> | null;
};

export class ClientIdentityAuditService {
  async listTimeline(clubId: number, clientId: string, take = 12): Promise<ClientIdentityAuditEntry[]> {
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true, clubId: true, name: true }
    });
    if (!client) {
      throw notFound('Cliente no encontrado', ErrorCodes.CLIENT_NOT_FOUND);
    }
    if (Number(client.clubId) !== Number(clubId)) {
      throw forbidden('El cliente no pertenece a este club.', ErrorCodes.CLIENT_OUT_OF_CLUB);
    }

    const [directLogs, mergeLogs] = await Promise.all([
      prisma.auditLog.findMany({
        where: {
          clubId: Number(clubId),
          entity: 'CLIENT',
          entityId: String(clientId),
          action: {
            in: ['USER_CLIENT_LINK', 'USER_CLIENT_UNLINK', 'CLIENTS_MERGED']
          }
        },
        include: {
          user: {
            select: { id: true, firstName: true, lastName: true, email: true }
          }
        },
        orderBy: { createdAt: 'desc' },
        take: Math.max(take, 20)
      }),
      prisma.auditLog.findMany({
        where: {
          clubId: Number(clubId),
          entity: 'CLIENT',
          action: 'CLIENTS_MERGED'
        },
        include: {
          user: {
            select: { id: true, firstName: true, lastName: true, email: true }
          }
        },
        orderBy: { createdAt: 'desc' },
        take: 100
      })
    ]);

    const extraMergeLogs = mergeLogs.filter((log: any) => {
      const payload = log?.payload && typeof log.payload === 'object' ? (log.payload as Record<string, any>) : null;
      return String(payload?.sourceClientId || '') === String(clientId) && String(log.entityId || '') !== String(clientId);
    });

    const dedup = new Map<string, any>();
    for (const log of [...directLogs, ...extraMergeLogs]) {
      dedup.set(String(log.id), log);
    }

    return Array.from(dedup.values())
      .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, take)
      .map((log: any) => {
        const descriptor = this.describeEvent(log, client.name || 'Cliente');
        return {
        id: String(log.id),
        action: String(log.action || ''),
        kind: descriptor.kind,
        kindLabel: descriptor.kindLabel,
        sourceLabel: descriptor.sourceLabel,
        summary: descriptor.summary,
        createdAt: new Date(log.createdAt),
        actorUser: log.user
          ? {
              id: Number(log.user.id),
              displayName: this.buildUserDisplayName(log.user),
              email: log.user.email || null
            }
          : null,
        payload: log?.payload && typeof log.payload === 'object' ? (log.payload as Record<string, any>) : null
      }});
  }

  private buildUserDisplayName(user: { id: number; firstName?: string | null; lastName?: string | null; email?: string | null }) {
    const fullName = `${String(user.firstName || '').trim()} ${String(user.lastName || '').trim()}`.trim();
    return fullName || String(user.email || '').trim() || `Usuario ${user.id}`;
  }

  private describeEvent(log: any, fallbackClientName: string): {
    kind: ClientIdentityAuditEntry['kind'];
    kindLabel: string;
    sourceLabel: string | null;
    summary: string;
  } {
    const payload = log?.payload && typeof log.payload === 'object' ? (log.payload as Record<string, any>) : {};
    const action = String(log?.action || '').trim().toUpperCase();
    const source = String(payload?.source || '').trim().toUpperCase();
    const reason = String(payload?.reason || '').trim().toUpperCase();

    if (action === 'USER_CLIENT_LINK') {
      const linkedUserId = Number(payload?.linkedUserId || 0);
      if (reason === 'SELF_CLAIM_LINK' || source === 'SELF_CLAIM') {
        return {
          kind: 'self_claim',
          kindLabel: 'Reclamo del jugador',
          sourceLabel: 'Perfil del jugador',
          summary: linkedUserId > 0
            ? `El jugador reclamó este perfil y se vinculó con el usuario #${linkedUserId}.`
            : 'El jugador reclamó este perfil.'
        };
      }
      if (source === 'DUPLICATE_INCIDENT') {
        return {
          kind: 'incident_link',
          kindLabel: 'Vínculo desde incidente',
          sourceLabel: 'Bandeja de duplicados',
          summary: linkedUserId > 0
            ? `Se resolvió un incidente y se vinculó este cliente con el usuario #${linkedUserId}.`
            : 'Se resolvió un incidente con un vínculo manual.'
        };
      }
      if (source === 'BOOKING') {
        if (reason === 'ALREADY_LINKED') {
          return {
            kind: 'already_linked',
            kindLabel: 'Cliente ya vinculado',
            sourceLabel: 'Reserva',
            summary: linkedUserId > 0
              ? `Una reserva reutilizó el vínculo existente con el usuario #${linkedUserId}.`
              : 'Una reserva reutilizó un vínculo existente.'
          };
        }
        return {
          kind: 'booking_link',
          kindLabel: reason === 'CREATED_CLIENT' ? 'Cliente creado desde reserva' : 'Vínculo desde reserva',
          sourceLabel: 'Reserva',
          summary: linkedUserId > 0
            ? `Una reserva vinculó este cliente con el usuario #${linkedUserId}.`
            : 'Una reserva generó un vínculo de identidad.'
        };
      }
      if (reason === 'CREATED_CLIENT') {
        return {
          kind: 'created_client',
          kindLabel: 'Cliente creado para el usuario',
          sourceLabel: this.mapSourceLabel(source),
          summary: linkedUserId > 0
            ? `Se creó este cliente directamente para el usuario #${linkedUserId}.`
            : 'Se creó este cliente desde un flujo de identidad.'
        };
      }
      if (reason === 'ALREADY_LINKED') {
        return {
          kind: 'already_linked',
          kindLabel: 'Cliente ya vinculado',
          sourceLabel: this.mapSourceLabel(source),
          summary: linkedUserId > 0
            ? `Se reutilizó el vínculo existente con el usuario #${linkedUserId}.`
            : 'Se reutilizó un vínculo existente.'
        };
      }
      return {
        kind: 'manual_link',
        kindLabel: 'Vínculo manual',
        sourceLabel: this.mapSourceLabel(source),
        summary: linkedUserId > 0
          ? `Se vinculó este cliente manualmente con el usuario #${linkedUserId}.`
          : 'Se vinculó este cliente manualmente con un usuario.'
      };
    }
    if (action === 'USER_CLIENT_UNLINK') {
      const unlinkedUserId = Number(payload?.unlinkedUserId || 0);
      return {
        kind: 'unlink',
        kindLabel: 'Desvinculación manual',
        sourceLabel: this.mapSourceLabel(source),
        summary: unlinkedUserId > 0
          ? `Se desvinculó el usuario #${unlinkedUserId} de este cliente.`
          : 'Se desvinculó el usuario de este cliente.'
      };
    }
    if (action === 'CLIENTS_MERGED') {
      const sourceClientId = String(payload?.sourceClientId || '').trim();
      const targetClientId = String(payload?.targetClientId || '').trim();
      const kind = payload?.incidentId ? 'merge_incident' : 'merge_manual';
      const kindLabel = payload?.incidentId ? 'Fusión desde incidente' : 'Fusión manual';
      const sourceLabel = payload?.incidentId ? 'Bandeja de incidentes' : 'Perfil del cliente';
      if (String(log.entityId || '') === sourceClientId) {
        return {
          kind,
          kindLabel,
          sourceLabel,
          summary: `Este cliente fue fusionado en ${targetClientId || 'otro cliente'}.`
        };
      }
      if (String(log.entityId || '') === targetClientId) {
        return {
          kind,
          kindLabel,
          sourceLabel,
          summary: `Se fusionó ${sourceClientId || 'otro cliente'} dentro de este cliente (${fallbackClientName}).`
        };
      }
      if (sourceClientId) {
        return {
          kind,
          kindLabel,
          sourceLabel,
          summary: `Este cliente participó en una fusión con ${sourceClientId}.`
        };
      }
    }
    return {
      kind: 'unknown',
      kindLabel: 'Cambio de identidad',
      sourceLabel: this.mapSourceLabel(source),
      summary: action || 'Cambio de identidad'
    };
  }

  private mapSourceLabel(source: string): string | null {
    if (source === 'CLIENT_PROFILE') return 'Perfil del cliente';
    if (source === 'SELF_CLAIM') return 'Perfil del jugador';
    if (source === 'DUPLICATE_INCIDENT') return 'Bandeja de duplicados';
    if (source === 'BOOKING') return 'Reserva';
    if (source === 'ADMIN_SELECTED_USER') return 'Selección manual';
    if (!source) return null;
    return source.toLowerCase().replace(/_/g, ' ');
  }
}
