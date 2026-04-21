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
        refreshToken: rotatedRefreshToken
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
}
