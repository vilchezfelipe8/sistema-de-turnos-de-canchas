import { prisma } from '../prisma';
import {
  type ResolveWhatsappSenderInput,
  type ResolveWhatsappSenderResult
} from '../types/notifications';

export const PIQUE_DEFAULT_SENDER_CODE = 'PIQUE_DEFAULT' as const;

export class WhatsappSenderResolver {
  async resolve(input: ResolveWhatsappSenderInput): Promise<ResolveWhatsappSenderResult> {
    if (!Number.isInteger(input.clubId) || input.clubId <= 0) {
      return {
        ok: false,
        errorCode: 'WHATSAPP_SENDER_INVALID',
        errorMessage: 'clubId inv\u00e1lido para resolver WhatsappSender'
      };
    }

    const clubOwnedSender = await prisma.whatsappSender.findFirst({
      where: {
        clubId: input.clubId,
        mode: 'CLUB_OWN',
        provider: 'META_CLOUD_API',
        status: 'ACTIVE'
      },
      select: {
        id: true,
        code: true,
        mode: true,
        provider: true,
        phoneNumberId: true,
        wabaId: true,
        tokenSecretRef: true,
        status: true
      }
    });

    if (clubOwnedSender) {
      return {
        ok: true,
        sender: clubOwnedSender
      };
    }

    const activeSender = await prisma.whatsappSender.findFirst({
      where: {
        code: PIQUE_DEFAULT_SENDER_CODE,
        mode: 'PIQUE_DEFAULT',
        provider: 'META_CLOUD_API',
        status: 'ACTIVE',
        clubId: null
      },
      select: {
        id: true,
        code: true,
        mode: true,
        provider: true,
        phoneNumberId: true,
        wabaId: true,
        tokenSecretRef: true,
        status: true
      }
    });

    if (activeSender) {
      return {
        ok: true,
        sender: activeSender
      };
    }

    const existingSender = await prisma.whatsappSender.findFirst({
      where: {
        code: PIQUE_DEFAULT_SENDER_CODE,
        mode: 'PIQUE_DEFAULT',
        provider: 'META_CLOUD_API',
        clubId: null
      },
      select: {
        id: true,
        code: true,
        mode: true,
        provider: true,
        phoneNumberId: true,
        wabaId: true,
        tokenSecretRef: true,
        status: true
      }
    });

    if (!existingSender) {
      return {
        ok: false,
        errorCode: 'WHATSAPP_SENDER_NOT_CONFIGURED',
        errorMessage:
          'PIQUE_DEFAULT no est\u00e1 configurado en DB. Debe bootstrapearse antes del cutover.'
      };
    }

    if (existingSender.status === 'DISABLED') {
      return {
        ok: false,
        errorCode: 'WHATSAPP_SENDER_DISABLED',
        errorMessage: 'PIQUE_DEFAULT existe pero est\u00e1 deshabilitado'
      };
    }

    return {
      ok: false,
      errorCode: 'WHATSAPP_SENDER_INVALID',
      errorMessage: `PIQUE_DEFAULT existe pero no est\u00e1 listo para uso MVP. status=${existingSender.status}`
    };
  }
}
