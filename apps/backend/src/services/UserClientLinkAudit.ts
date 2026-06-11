export type UserClientLinkReason =
  | 'ALREADY_LINKED'
  | 'CREATED_CLIENT'
  | 'MANUAL_ADMIN_LINK'
  | 'SELF_CLAIM_LINK';

export async function recordUserClientLinkAuditTx(
  tx: any,
  input: {
    clubId: number;
    userId: number;
    clientId: string;
    reason: UserClientLinkReason;
    source: string;
    actorUserId?: number | null;
    payload?: Record<string, any> | null;
  }
) {
  try {
    if (!tx || !(tx as any).auditLog) return;
    await (tx as any).auditLog.create({
      data: {
        clubId: Number(input.clubId),
        userId: Number(input.actorUserId || 0) > 0 ? Number(input.actorUserId) : Number(input.userId),
        entity: 'CLIENT',
        entityId: String(input.clientId),
        action: 'USER_CLIENT_LINK',
        payload: {
          linkedUserId: Number(input.userId),
          reason: String(input.reason),
          source: String(input.source || 'UNKNOWN'),
          ...(input.payload || {})
        }
      }
    });
  } catch {
    // La trazabilidad no debe romper el flujo principal.
  }
}
