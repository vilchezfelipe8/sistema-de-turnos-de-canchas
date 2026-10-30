import crypto from 'crypto';
import { AuthSessionStatus, Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { authConfig } from '../utils/authConfig';
import { AuthTokenService } from './AuthTokenService';

export type SessionClientMeta = {
  ip?: string | null;
  userAgent?: string | null;
  deviceLabel?: string | null;
};

type IssueSessionInput = {
  userId: number;
  role: string;
  meta?: SessionClientMeta;
};

type RotateSessionInput = {
  refreshToken: string;
  meta?: SessionClientMeta;
};

const addDays = (source: Date, days: number) => new Date(source.getTime() + days * 24 * 60 * 60 * 1000);

// Renovaciones simultáneas (dos pestañas, la app y el navegador, o una respuesta perdida por mala señal):
// si llega una credencial rotada hace menos de este tiempo, no se trata como robo y la sesión sigue.
const ROTATION_GRACE_MS = 60_000;

const normalizeMeta = (meta?: SessionClientMeta) => ({
  ip: String(meta?.ip || '').trim() || null,
  userAgent: String(meta?.userAgent || '').trim() || null,
  deviceLabel: String(meta?.deviceLabel || '').trim() || null
});

export class AuthSessionService {
  private readonly tokenService = new AuthTokenService();

  private buildExpiryWindow(now: Date) {
    const idleExpiresAt = addDays(now, authConfig.refreshIdleDays);
    const absoluteExpiresAt = addDays(now, authConfig.refreshAbsoluteDays);
    return {
      idleExpiresAt,
      absoluteExpiresAt,
      effectiveExpiresAt: idleExpiresAt < absoluteExpiresAt ? idleExpiresAt : absoluteExpiresAt
    };
  }

  private async revokeFamilyTx(
    tx: Prisma.TransactionClient,
    familyId: string,
    now: Date
  ) {
    await tx.authSession.updateMany({
      where: {
        familyId,
        status: {
          in: [AuthSessionStatus.ACTIVE, AuthSessionStatus.ROTATED]
        }
      },
      data: {
        status: AuthSessionStatus.REVOKED,
        revokedAt: now,
        lastSeenAt: now
      }
    });
  }

  async issueSession(input: IssueSessionInput) {
    const now = new Date();
    const refreshToken = this.tokenService.generateRefreshToken();
    const refreshTokenHash = this.tokenService.hashRefreshToken(refreshToken);
    const familyId = crypto.randomUUID();
    const meta = normalizeMeta(input.meta);
    const window = this.buildExpiryWindow(now);

    const session = await prisma.authSession.create({
      data: {
        userId: input.userId,
        refreshTokenHash,
        familyId,
        status: AuthSessionStatus.ACTIVE,
        ip: meta.ip,
        userAgent: meta.userAgent,
        deviceLabel: meta.deviceLabel,
        expiresAt: window.effectiveExpiresAt,
        absoluteExpiresAt: window.absoluteExpiresAt,
        lastSeenAt: now
      }
    });

    const accessToken = this.tokenService.signAccessToken({
      userId: input.userId,
      role: input.role,
      sid: session.id
    });

    return { session, accessToken, refreshToken };
  }

  // Si la sesión se acaba de rotar (dentro de la tolerancia), devuelve un acceso válido para la sesión
  // activa más nueva de la misma familia, sin emitir otra credencial de renovación (la cookie buena
  // ya la recibió el pedido que rotó primero).
  private async resolveRecentRotationTx(
    tx: Prisma.TransactionClient,
    session: { familyId: string; userId: number; status: AuthSessionStatus; rotatedAt: Date | null },
    role: string,
    now: Date
  ) {
    if (session.status !== AuthSessionStatus.ROTATED || !session.rotatedAt) return null;
    if (now.getTime() - new Date(session.rotatedAt).getTime() > ROTATION_GRACE_MS) return null;
    const latest = await tx.authSession.findFirst({
      where: { familyId: session.familyId, status: AuthSessionStatus.ACTIVE },
      orderBy: { createdAt: 'desc' }
    });
    if (!latest || latest.expiresAt <= now || latest.absoluteExpiresAt <= now) return null;
    const accessToken = this.tokenService.signAccessToken({ userId: session.userId, role, sid: latest.id });
    return { ok: true as const, session: latest, accessToken, refreshToken: null as string | null };
  }

  async rotateSession(input: RotateSessionInput) {
    const now = new Date();
    const incomingHash = this.tokenService.hashRefreshToken(input.refreshToken);
    const meta = normalizeMeta(input.meta);

    return prisma.$transaction(async (tx) => {
      const current = await tx.authSession.findUnique({
        where: { refreshTokenHash: incomingHash },
        include: {
          user: {
            select: {
              role: true
            }
          }
        }
      });

      if (!current) {
        return { ok: false as const, reason: 'AUTH_INVALID' as const };
      }

      if (current.status !== AuthSessionStatus.ACTIVE) {
        const recent = await this.resolveRecentRotationTx(tx, current, current.user.role, now);
        if (recent) return recent;
        await this.revokeFamilyTx(tx, current.familyId, now);
        return { ok: false as const, reason: 'AUTH_REVOKED' as const };
      }

      if (current.absoluteExpiresAt <= now || current.expiresAt <= now) {
        await tx.authSession.update({
          where: { id: current.id },
          data: {
            status: AuthSessionStatus.EXPIRED,
            lastSeenAt: now,
            revokedAt: now
          }
        });
        return { ok: false as const, reason: 'AUTH_EXPIRED' as const };
      }

      const rotatedRefreshToken = this.tokenService.generateRefreshToken();
      const rotatedRefreshHash = this.tokenService.hashRefreshToken(rotatedRefreshToken);
      const idleExpiresAt = addDays(now, authConfig.refreshIdleDays);
      const effectiveExpiresAt =
        idleExpiresAt < current.absoluteExpiresAt ? idleExpiresAt : current.absoluteExpiresAt;

      const rotateUpdated = await tx.authSession.updateMany({
        where: {
          id: current.id,
          status: AuthSessionStatus.ACTIVE,
          refreshTokenHash: incomingHash
        },
        data: {
          status: AuthSessionStatus.ROTATED,
          rotatedAt: now,
          lastSeenAt: now
        }
      });

      if (rotateUpdated.count !== 1) {
        // Otro pedido la rotó en el mismo instante: si fue recién, se sigue con la sesión nueva.
        const latestState = await tx.authSession.findUnique({ where: { id: current.id } });
        if (latestState) {
          const recent = await this.resolveRecentRotationTx(tx, latestState, current.user.role, now);
          if (recent) return recent;
        }
        await this.revokeFamilyTx(tx, current.familyId, now);
        return { ok: false as const, reason: 'AUTH_REVOKED' as const };
      }

      const nextSession = await tx.authSession.create({
        data: {
          userId: current.userId,
          refreshTokenHash: rotatedRefreshHash,
          familyId: current.familyId,
          parentSessionId: current.id,
          status: AuthSessionStatus.ACTIVE,
          ip: meta.ip || current.ip,
          userAgent: meta.userAgent || current.userAgent,
          deviceLabel: meta.deviceLabel || current.deviceLabel,
          expiresAt: effectiveExpiresAt,
          absoluteExpiresAt: current.absoluteExpiresAt,
          lastSeenAt: now
        }
      });

      const accessToken = this.tokenService.signAccessToken({
        userId: current.userId,
        role: current.user.role,
        sid: nextSession.id
      });

      return {
        ok: true as const,
        session: nextSession,
        accessToken,
        refreshToken: rotatedRefreshToken as string | null
      };
    });
  }

  async revokeCurrentSessionByRefreshToken(refreshToken: string | null | undefined) {
    if (!refreshToken) return;
    const refreshTokenHash = this.tokenService.hashRefreshToken(refreshToken);
    const now = new Date();

    await prisma.authSession.updateMany({
      where: {
        refreshTokenHash,
        status: {
          in: [AuthSessionStatus.ACTIVE, AuthSessionStatus.ROTATED]
        }
      },
      data: {
        status: AuthSessionStatus.REVOKED,
        revokedAt: now,
        lastSeenAt: now
      }
    });
  }

  async revokeSessionById(sessionId: string | null | undefined) {
    if (!sessionId) return;
    const now = new Date();
    await prisma.authSession.updateMany({
      where: {
        id: sessionId,
        status: {
          in: [AuthSessionStatus.ACTIVE, AuthSessionStatus.ROTATED]
        }
      },
      data: {
        status: AuthSessionStatus.REVOKED,
        revokedAt: now,
        lastSeenAt: now
      }
    });
  }

  async revokeAllUserSessions(userId: number) {
    const now = new Date();
    await prisma.authSession.updateMany({
      where: {
        userId,
        status: {
          in: [AuthSessionStatus.ACTIVE, AuthSessionStatus.ROTATED]
        }
      },
      data: {
        status: AuthSessionStatus.REVOKED,
        revokedAt: now,
        lastSeenAt: now
      }
    });
  }

  async touchSession(sessionId: string | null | undefined) {
    if (!sessionId) return;
    await prisma.authSession.updateMany({
      where: { id: sessionId, status: AuthSessionStatus.ACTIVE },
      data: { lastSeenAt: new Date() }
    });
  }

  async listUserSessions(userId: number, currentSessionId?: string | null) {
    const sessions = await prisma.authSession.findMany({
      where: {
        userId,
        status: {
          in: [AuthSessionStatus.ACTIVE, AuthSessionStatus.ROTATED]
        }
      },
      orderBy: [
        { lastSeenAt: 'desc' },
        { createdAt: 'desc' }
      ],
      select: {
        id: true,
        status: true,
        ip: true,
        userAgent: true,
        deviceLabel: true,
        createdAt: true,
        lastSeenAt: true,
        expiresAt: true,
        absoluteExpiresAt: true
      }
    });

    return sessions.map((session) => ({
      ...session,
      isCurrent: currentSessionId ? session.id === currentSessionId : false
    }));
  }
}
