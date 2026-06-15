import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const SENDER_CODE = 'PIQUE_DEFAULT' as const;
const LANGUAGE_CODE = 'es_AR' as const;

const TEMPLATE_SPECS = [
  {
    templateName: 'customer_booking_created_v1',
    eventType: 'BOOKING_CREATED',
    recipientRole: 'CUSTOMER'
  },
  {
    templateName: 'customer_booking_cancelled_v1',
    eventType: 'BOOKING_CANCELLED',
    recipientRole: 'CUSTOMER'
  },
  {
    templateName: 'customer_booking_pending_warning_v1',
    eventType: 'BOOKING_PENDING_WARNING',
    recipientRole: 'CUSTOMER'
  },
  {
    templateName: 'staff_booking_created_v1',
    eventType: 'BOOKING_CREATED',
    recipientRole: 'CLUB_STAFF'
  },
  {
    templateName: 'staff_booking_cancelled_v1',
    eventType: 'BOOKING_CANCELLED',
    recipientRole: 'CLUB_STAFF'
  },
  {
    templateName: 'staff_booking_pending_warning_v1',
    eventType: 'BOOKING_PENDING_WARNING',
    recipientRole: 'CLUB_STAFF'
  }
] as const;

const readRequiredEnv = (name: string) => {
  const value = String(process.env[name] || '').trim();
  if (!value) {
    throw new Error(`Falta ${name} en el entorno.`);
  }
  return value;
};

async function main() {
  const displayName = String(process.env.WHATSAPP_SENDER_DISPLAY_NAME || 'Pique').trim() || 'Pique';
  const tokenSecretRef =
    String(process.env.WHATSAPP_META_TOKEN_SECRET_REF || 'WHATSAPP_META_ACCESS_TOKEN').trim() ||
    'WHATSAPP_META_ACCESS_TOKEN';

  const phoneNumberId = readRequiredEnv('WHATSAPP_META_PHONE_NUMBER_ID');
  const wabaId = readRequiredEnv('WHATSAPP_META_WABA_ID');
  const businessPhone = readRequiredEnv('WHATSAPP_META_BUSINESS_PHONE');

  if (!String(process.env[tokenSecretRef] || '').trim()) {
    throw new Error(
      `Falta cargar el access token real en la variable referenciada por tokenSecretRef: ${tokenSecretRef}.`
    );
  }

  const sender = await prisma.whatsappSender.upsert({
    where: { code: SENDER_CODE },
    update: {
      clubId: null,
      mode: 'PIQUE_DEFAULT',
      provider: 'META_CLOUD_API',
      displayName,
      wabaId,
      phoneNumberId,
      businessPhone,
      tokenSecretRef,
      status: 'ACTIVE'
    },
    create: {
      code: SENDER_CODE,
      clubId: null,
      mode: 'PIQUE_DEFAULT',
      provider: 'META_CLOUD_API',
      displayName,
      wabaId,
      phoneNumberId,
      businessPhone,
      tokenSecretRef,
      status: 'ACTIVE'
    }
  });

  for (const spec of TEMPLATE_SPECS) {
    const existing = await prisma.whatsappTemplateMapping.findFirst({
      where: {
        senderId: sender.id,
        eventType: spec.eventType,
        recipientRole: spec.recipientRole,
        languageCode: LANGUAGE_CODE,
        version: 1
      },
      select: { id: true }
    });

    if (existing) {
      await prisma.whatsappTemplateMapping.update({
        where: { id: existing.id },
        data: {
          templateName: spec.templateName,
          category: 'UTILITY',
          status: 'ACTIVE'
        }
      });
      continue;
    }

    await prisma.whatsappTemplateMapping.create({
      data: {
        senderId: sender.id,
        eventType: spec.eventType,
        recipientRole: spec.recipientRole,
        templateName: spec.templateName,
        languageCode: LANGUAGE_CODE,
        category: 'UTILITY',
        status: 'ACTIVE',
        version: 1
      }
    });
  }

  console.log('✅ WhatsApp Cloud API bootstrap completado');
  console.log(`- sender: ${sender.code} (${sender.id})`);
  console.log(`- tokenSecretRef: ${tokenSecretRef}`);
  console.log(`- templates activos: ${TEMPLATE_SPECS.length}`);
}

main()
  .catch((error) => {
    console.error('❌ No se pudo bootstrapear WhatsApp Cloud API:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
