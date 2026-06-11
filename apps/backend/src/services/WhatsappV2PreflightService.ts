import { PrismaClient, Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { featureFlags } from '../config/featureFlags';
import { getWhatsappMetaConfig } from '../utils/whatsappMetaConfig';
import {
  type WhatsappPreflightCheck,
  type WhatsappV2PreflightResult
} from '../types/notifications';

type DbClient = Prisma.TransactionClient | PrismaClient;

type FeatureFlagsReader = {
  ENABLE_WHATSAPP_CUSTOMER_EVENTS_V2: boolean;
  ENABLE_WHATSAPP_STAFF_EVENTS_V2: boolean;
  ENABLE_WHATSAPP_SEND_V2: boolean;
  ENABLE_WHATSAPP_CLOUD_API: boolean;
  ENABLE_WHATSAPP_WEBHOOK_PROCESSOR: boolean;
  ENABLE_WHATSAPP_V2_DRY_RUN: boolean;
};

type MetaConfigReader = {
  webhookVerifyToken: string;
};

type PreflightDeps = {
  db?: DbClient;
  flags?: FeatureFlagsReader;
  metaConfig?: MetaConfigReader;
};

const REQUIRED_TEMPLATE_KEYS = [
  {
    key: 'customer_booking_created_v1',
    eventType: 'BOOKING_CREATED',
    recipientRole: 'CUSTOMER'
  },
  {
    key: 'customer_booking_cancelled_v1',
    eventType: 'BOOKING_CANCELLED',
    recipientRole: 'CUSTOMER'
  },
  {
    key: 'customer_booking_pending_warning_v1',
    eventType: 'BOOKING_PENDING_WARNING',
    recipientRole: 'CUSTOMER'
  },
  {
    key: 'staff_booking_created_v1',
    eventType: 'BOOKING_CREATED',
    recipientRole: 'CLUB_STAFF'
  },
  {
    key: 'staff_booking_cancelled_v1',
    eventType: 'BOOKING_CANCELLED',
    recipientRole: 'CLUB_STAFF'
  },
  {
    key: 'staff_booking_pending_warning_v1',
    eventType: 'BOOKING_PENDING_WARNING',
    recipientRole: 'CLUB_STAFF'
  }
] as const;

export class WhatsappV2PreflightService {
  private readonly db: DbClient;
  private readonly flags: FeatureFlagsReader;
  private readonly metaConfig: MetaConfigReader;

  constructor(deps: PreflightDeps = {}) {
    this.db = deps.db ?? prisma;
    this.flags = deps.flags ?? featureFlags;
    this.metaConfig = deps.metaConfig ?? getWhatsappMetaConfig();
  }

  async run(): Promise<WhatsappV2PreflightResult> {
    const checks: WhatsappPreflightCheck[] = [];

    const sender = await this.db.whatsappSender.findFirst({
      where: {
        code: 'PIQUE_DEFAULT',
        mode: 'PIQUE_DEFAULT',
        provider: 'META_CLOUD_API',
        clubId: null
      },
      select: {
        id: true,
        status: true,
        provider: true,
        phoneNumberId: true,
        wabaId: true,
        tokenSecretRef: true
      }
    });

    checks.push(
      sender
        ? {
            key: 'sender.exists',
            severity: 'INFO',
            ok: true,
            message: 'PIQUE_DEFAULT existe en DB.'
          }
        : {
            key: 'sender.exists',
            severity: 'ERROR',
            ok: false,
            message: 'PIQUE_DEFAULT no existe en DB.'
          }
    );

    checks.push(
      sender?.status === 'ACTIVE'
        ? {
            key: 'sender.active',
            severity: 'INFO',
            ok: true,
            message: 'PIQUE_DEFAULT está ACTIVE.'
          }
        : {
            key: 'sender.active',
            severity: 'ERROR',
            ok: false,
            message: 'PIQUE_DEFAULT no está ACTIVE.'
          }
    );

    checks.push(
      sender?.phoneNumberId
        ? {
            key: 'sender.phoneNumberId',
            severity: 'INFO',
            ok: true,
            message: 'PIQUE_DEFAULT tiene phoneNumberId.'
          }
        : {
            key: 'sender.phoneNumberId',
            severity: 'ERROR',
            ok: false,
            message: 'PIQUE_DEFAULT no tiene phoneNumberId.'
          }
    );

    checks.push(
      sender?.wabaId
        ? {
            key: 'sender.wabaId',
            severity: 'INFO',
            ok: true,
            message: 'PIQUE_DEFAULT tiene wabaId.'
          }
        : {
            key: 'sender.wabaId',
            severity: 'ERROR',
            ok: false,
            message: 'PIQUE_DEFAULT no tiene wabaId.'
          }
    );

    checks.push(
      sender?.tokenSecretRef
        ? {
            key: 'sender.tokenSecretRef',
            severity: 'INFO',
            ok: true,
            message: 'PIQUE_DEFAULT tiene tokenSecretRef.'
          }
        : {
            key: 'sender.tokenSecretRef',
            severity: 'ERROR',
            ok: false,
            message: 'PIQUE_DEFAULT no tiene tokenSecretRef.'
          }
    );

    checks.push(
      sender?.tokenSecretRef && String(process.env[sender.tokenSecretRef] || '').trim()
        ? {
            key: 'sender.tokenEnv',
            severity: 'INFO',
            ok: true,
            message: `Existe env cargado para ${sender.tokenSecretRef}.`
          }
        : {
            key: 'sender.tokenEnv',
            severity: 'ERROR',
            ok: false,
            message: sender?.tokenSecretRef
              ? `No existe env cargado para ${sender.tokenSecretRef}.`
              : 'No se puede validar env del token porque falta tokenSecretRef.'
          }
    );

    for (const required of REQUIRED_TEMPLATE_KEYS) {
      const template = sender?.id
        ? await this.db.whatsappTemplateMapping.findFirst({
            where: {
              senderId: sender.id,
              eventType: required.eventType,
              recipientRole: required.recipientRole,
              languageCode: 'es_AR',
              status: 'ACTIVE'
            },
            select: {
              id: true,
              templateName: true
            }
          })
        : null;

      checks.push(
        template?.templateName === required.key
          ? {
              key: `template.${required.key}`,
              severity: 'INFO',
              ok: true,
              message: `Template activo encontrado: ${required.key}.`
            }
          : {
              key: `template.${required.key}`,
              severity: 'ERROR',
              ok: false,
              message: `Falta template activo requerido: ${required.key}.`
            }
      );
    }

    checks.push(
      this.flags.ENABLE_WHATSAPP_WEBHOOK_PROCESSOR &&
      !String(this.metaConfig.webhookVerifyToken || '').trim()
        ? {
            key: 'webhook.verifyToken',
            severity: 'ERROR',
            ok: false,
            message: 'ENABLE_WHATSAPP_WEBHOOK_PROCESSOR=true pero falta WHATSAPP_META_WEBHOOK_VERIFY_TOKEN.'
          }
        : {
            key: 'webhook.verifyToken',
            severity: 'INFO',
            ok: true,
            message: 'Webhook verify token consistente con la configuración actual.'
          }
    );

    if (this.flags.ENABLE_WHATSAPP_CUSTOMER_EVENTS_V2 && !this.flags.ENABLE_WHATSAPP_SEND_V2) {
      checks.push({
        key: 'flags.customerWithoutSendV2',
        severity: 'WARNING',
        ok: true,
        message: 'CUSTOMER V2 está activo pero ENABLE_WHATSAPP_SEND_V2 está apagado.'
      });
    }

    if (this.flags.ENABLE_WHATSAPP_STAFF_EVENTS_V2 && !this.flags.ENABLE_WHATSAPP_SEND_V2) {
      checks.push({
        key: 'flags.staffWithoutSendV2',
        severity: 'WARNING',
        ok: true,
        message: 'CLUB_STAFF V2 está activo pero ENABLE_WHATSAPP_SEND_V2 está apagado.'
      });
    }

    if (this.flags.ENABLE_WHATSAPP_SEND_V2 && !this.flags.ENABLE_WHATSAPP_CLOUD_API) {
      checks.push({
        key: 'flags.sendV2WithoutCloudApi',
        severity: 'WARNING',
        ok: true,
        message: 'ENABLE_WHATSAPP_SEND_V2 está activo pero ENABLE_WHATSAPP_CLOUD_API está apagado.'
      });
    }

    if (this.flags.ENABLE_WHATSAPP_V2_DRY_RUN && this.flags.ENABLE_WHATSAPP_CLOUD_API) {
      checks.push({
        key: 'flags.dryRunWins',
        severity: 'WARNING',
        ok: true,
        message: 'ENABLE_WHATSAPP_V2_DRY_RUN=true tiene precedencia y evita envíos reales aunque Cloud API esté activa.'
      });
    }

    const hasErrors = checks.some((check) => check.severity === 'ERROR' && !check.ok);
    const hasWarnings = checks.some((check) => check.severity === 'WARNING');

    return {
      ok: !hasErrors,
      status: hasErrors ? 'FAIL' : hasWarnings ? 'WARN' : 'OK',
      checks
    };
  }
}
