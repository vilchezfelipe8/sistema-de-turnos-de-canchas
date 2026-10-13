import crypto from 'crypto';
import { Prisma, UserVerificationChannel, UserVerificationPurpose } from '@prisma/client';
import { prisma } from '../prisma';
import { logger } from '../utils/logger';
import { AuthEmailService } from './AuthEmailService';
import { WhatsappNotificationOutboxService } from './WhatsappNotificationOutboxService';

// Códigos de un solo uso para activar cuentas pre-creadas (padrón de socios) y recuperar contraseña.
export const VERIFICATION_CODE_LENGTH = 6;
export const VERIFICATION_CODE_TTL_MINUTES = 10;
export const VERIFICATION_CODE_MAX_ATTEMPTS = 5;
// Envíos automáticos (WhatsApp/email) por usuario y propósito en una hora. Los del mostrador no cuentan.
export const VERIFICATION_CODE_MAX_SENDS_PER_HOUR = 5;

type TxClient = Prisma.TransactionClient;

export type IssueVerificationCodeInput = {
  userId: number;
  purpose: UserVerificationPurpose;
  channel: UserVerificationChannel;
  issuedByUserId?: number | null;
  issuedForClubId?: number | null;
};

export type IssueVerificationCodeResult =
  | { ok: true; codeId: string; expiresAt: Date; code?: string }
  | { ok: false; reason: 'RATE_LIMITED' | 'NO_DELIVERY_TARGET' };

export type VerifyCodeResult =
  | { ok: true; codeId: string }
  | { ok: false; reason: 'INVALID_OR_EXPIRED' | 'TOO_MANY_ATTEMPTS' };

const getPepper = () =>
  String(process.env.VERIFICATION_CODE_PEPPER || process.env.JWT_SECRET || 'pique-verification-code').trim();

export const hashVerificationCode = (userId: number, code: string) =>
  crypto.createHash('sha256').update(`${userId}:${code}:${getPepper()}`).digest('hex');

const generateNumericCode = () =>
  String(crypto.randomInt(0, 10 ** VERIFICATION_CODE_LENGTH)).padStart(VERIFICATION_CODE_LENGTH, '0');

const safeEqualHex = (a: string, b: string) => {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};

export class AccountVerificationService {
  private readonly whatsappOutbox = new WhatsappNotificationOutboxService();
  private emailService: AuthEmailService | null = null;

  private getEmailService() {
    if (!this.emailService) this.emailService = new AuthEmailService();
    return this.emailService;
  }

  // Club por el que sale el WhatsApp: el indicado, el que pre-creó la cuenta o el último club donde tiene ficha.
  private async resolveDeliveryClubId(
    client: TxClient | typeof prisma,
    user: { id: number; createdByClubId: number | null },
    issuedForClubId?: number | null
  ): Promise<number | null> {
    if (issuedForClubId) return issuedForClubId;
    if (user.createdByClubId) return user.createdByClubId;
    const latestClient = await client.client.findFirst({
      where: { userId: user.id },
      orderBy: { updatedAt: 'desc' },
      select: { clubId: true }
    });
    return latestClient?.clubId ?? null;
  }

  async issueCode(input: IssueVerificationCodeInput): Promise<IssueVerificationCodeResult> {
    const user = await prisma.user.findUnique({
      where: { id: input.userId },
      select: { id: true, email: true, phoneNumber: true, createdByClubId: true }
    });
    if (!user) return { ok: false, reason: 'NO_DELIVERY_TARGET' };

    const now = new Date();
    if (input.channel !== 'ADMIN_ISSUED') {
      const recentSends = await prisma.userVerificationCode.count({
        where: {
          userId: user.id,
          purpose: input.purpose,
          channel: { not: 'ADMIN_ISSUED' },
          createdAt: { gte: new Date(now.getTime() - 60 * 60 * 1000) }
        }
      });
      if (recentSends >= VERIFICATION_CODE_MAX_SENDS_PER_HOUR) {
        return { ok: false, reason: 'RATE_LIMITED' };
      }
    }

    const deliveryClubId =
      input.channel === 'WHATSAPP'
        ? await this.resolveDeliveryClubId(prisma, user, input.issuedForClubId)
        : null;
    if (input.channel === 'WHATSAPP' && (!deliveryClubId || !String(user.phoneNumber || '').trim())) {
      return { ok: false, reason: 'NO_DELIVERY_TARGET' };
    }
    if (input.channel === 'EMAIL' && !String(user.email || '').trim()) {
      return { ok: false, reason: 'NO_DELIVERY_TARGET' };
    }

    const code = generateNumericCode();
    const expiresAt = new Date(now.getTime() + VERIFICATION_CODE_TTL_MINUTES * 60 * 1000);

    const created = await prisma.$transaction(async (tx) => {
      // Un solo código vigente por usuario y propósito.
      await tx.userVerificationCode.updateMany({
        where: { userId: user.id, purpose: input.purpose, consumedAt: null },
        data: { consumedAt: now }
      });

      const row = await tx.userVerificationCode.create({
        data: {
          userId: user.id,
          purpose: input.purpose,
          channel: input.channel,
          codeHash: hashVerificationCode(user.id, code),
          expiresAt,
          issuedByUserId: input.issuedByUserId ?? null,
          issuedForClubId: input.issuedForClubId ?? null
        }
      });

      if (input.channel === 'WHATSAPP' && deliveryClubId) {
        await this.whatsappOutbox.enqueueSendV2(
          {
            eventType: 'ACCOUNT_VERIFICATION_CODE',
            recipientRole: 'CUSTOMER',
            clubId: deliveryClubId,
            recipientPhone: user.phoneNumber,
            referenceType: 'USER',
            referenceId: String(user.id),
            dedupeKey: `verification-code:${row.id}`,
            templateParams: { code },
            templateParameterOrder: ['code'],
            metadata: { purpose: input.purpose }
          },
          tx
        );
      }

      return row;
    });

    if (input.channel === 'EMAIL' && user.email) {
      try {
        await this.getEmailService().sendVerificationCode(user.email, code, VERIFICATION_CODE_TTL_MINUTES, input.purpose);
      } catch (error) {
        logger.error({ err: error, userId: user.id, action: 'sendVerificationCode' }, 'No se pudo enviar el código por email');
      }
    }

    // Solo el código emitido en el mostrador se devuelve: el operador se lo entrega en mano al socio.
    return input.channel === 'ADMIN_ISSUED'
      ? { ok: true, codeId: created.id, expiresAt, code }
      : { ok: true, codeId: created.id, expiresAt };
  }

  async verifyCode(input: { userId: number; purpose: UserVerificationPurpose; code: string }): Promise<VerifyCodeResult> {
    const code = String(input.code || '').replace(/\D/g, '');
    const now = new Date();

    return prisma.$transaction(async (tx) => {
      const current = await tx.userVerificationCode.findFirst({
        where: { userId: input.userId, purpose: input.purpose, consumedAt: null, expiresAt: { gt: now } },
        orderBy: { createdAt: 'desc' }
      });
      if (!current) return { ok: false, reason: 'INVALID_OR_EXPIRED' } as const;
      if (current.attempts >= VERIFICATION_CODE_MAX_ATTEMPTS) {
        return { ok: false, reason: 'TOO_MANY_ATTEMPTS' } as const;
      }

      const matches = code.length === VERIFICATION_CODE_LENGTH &&
        safeEqualHex(current.codeHash, hashVerificationCode(input.userId, code));

      if (!matches) {
        const attempts = current.attempts + 1;
        await tx.userVerificationCode.update({
          where: { id: current.id },
          data: {
            attempts,
            // Al agotar los intentos el código queda inutilizable.
            ...(attempts >= VERIFICATION_CODE_MAX_ATTEMPTS ? { consumedAt: now } : {})
          }
        });
        return {
          ok: false,
          reason: attempts >= VERIFICATION_CODE_MAX_ATTEMPTS ? 'TOO_MANY_ATTEMPTS' : 'INVALID_OR_EXPIRED'
        } as const;
      }

      await tx.userVerificationCode.update({
        where: { id: current.id },
        data: { consumedAt: now, attempts: current.attempts + 1 }
      });
      return { ok: true, codeId: current.id } as const;
    });
  }
}
