import { prisma } from '../prisma';
import {
  DEFAULT_WHATSAPP_TEMPLATE_LANGUAGE,
  type ResolveWhatsappTemplateInput,
  type ResolveWhatsappTemplateResult
} from '../types/notifications';

export class WhatsappTemplateResolver {
  async resolve(input: ResolveWhatsappTemplateInput): Promise<ResolveWhatsappTemplateResult> {
    const languageCode =
      String(input.languageCode || '').trim() || DEFAULT_WHATSAPP_TEMPLATE_LANGUAGE;

    const activeTemplate = await prisma.whatsappTemplateMapping.findFirst({
      where: {
        senderId: input.senderId,
        eventType: input.eventType,
        recipientRole: input.recipientRole,
        languageCode,
        status: 'ACTIVE'
      },
      select: {
        id: true,
        templateName: true,
        languageCode: true,
        category: true,
        status: true
      }
    });

    if (activeTemplate) {
      return {
        ok: true,
        template: activeTemplate
      };
    }

    const sameRoleTemplate = await prisma.whatsappTemplateMapping.findFirst({
      where: {
        senderId: input.senderId,
        eventType: input.eventType,
        recipientRole: input.recipientRole,
        languageCode
      },
      select: {
        status: true
      }
    });

    if (sameRoleTemplate) {
      return {
        ok: false,
        errorCode: 'WHATSAPP_TEMPLATE_DISABLED',
        errorMessage: `El template existe pero no est\u00e1 activo. status=${sameRoleTemplate.status}`
      };
    }

    const otherRoleTemplate = await prisma.whatsappTemplateMapping.findFirst({
      where: {
        senderId: input.senderId,
        eventType: input.eventType,
        languageCode,
        status: 'ACTIVE',
        NOT: {
          recipientRole: input.recipientRole
        }
      },
      select: {
        recipientRole: true,
        templateName: true
      }
    });

    if (otherRoleTemplate) {
      return {
        ok: false,
        errorCode: 'WHATSAPP_TEMPLATE_INVALID_ROLE',
        errorMessage:
          `Existe template activo para ${otherRoleTemplate.recipientRole}, no para ${input.recipientRole}`
      };
    }

    return {
      ok: false,
      errorCode: 'WHATSAPP_TEMPLATE_NOT_CONFIGURED',
      errorMessage: 'No existe template configurado para sender/eventType/recipientRole/languageCode'
    };
  }
}
