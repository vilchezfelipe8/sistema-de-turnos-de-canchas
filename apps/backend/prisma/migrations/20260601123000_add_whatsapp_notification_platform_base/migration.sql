CREATE TYPE "NotificationRecipientRole" AS ENUM ('CUSTOMER', 'CLUB_STAFF');

CREATE TYPE "NotificationEventType" AS ENUM ('BOOKING_CREATED', 'BOOKING_CANCELLED', 'BOOKING_PENDING_WARNING');

CREATE TYPE "WhatsappSenderMode" AS ENUM ('PIQUE_DEFAULT', 'CLUB_OWN');

CREATE TYPE "WhatsappProvider" AS ENUM ('META_CLOUD_API', 'WHATSAPP_WEB_LEGACY');

CREATE TYPE "WhatsappSenderStatus" AS ENUM ('ACTIVE', 'DISABLED', 'PENDING_SETUP', 'ERROR');

CREATE TYPE "WhatsappTemplateStatus" AS ENUM ('ACTIVE', 'DISABLED', 'PENDING_APPROVAL', 'REJECTED');

CREATE TYPE "WhatsappTemplateCategory" AS ENUM ('UTILITY', 'MARKETING', 'AUTHENTICATION');

CREATE TYPE "WhatsappDeliveryStatus" AS ENUM ('QUEUED', 'ACCEPTED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SKIPPED');

CREATE TABLE "WhatsappSender" (
    "id" TEXT NOT NULL,
    "clubId" INTEGER,
    "code" TEXT NOT NULL,
    "mode" "WhatsappSenderMode" NOT NULL,
    "provider" "WhatsappProvider" NOT NULL,
    "displayName" TEXT NOT NULL,
    "wabaId" TEXT,
    "phoneNumberId" TEXT,
    "businessPhone" TEXT,
    "tokenSecretRef" TEXT,
    "status" "WhatsappSenderStatus" NOT NULL DEFAULT 'PENDING_SETUP',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WhatsappSender_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WhatsappTemplateMapping" (
    "id" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "eventType" "NotificationEventType" NOT NULL,
    "recipientRole" "NotificationRecipientRole" NOT NULL,
    "templateName" TEXT NOT NULL,
    "languageCode" TEXT NOT NULL,
    "category" "WhatsappTemplateCategory" NOT NULL DEFAULT 'UTILITY',
    "status" "WhatsappTemplateStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WhatsappTemplateMapping_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WhatsappDelivery" (
    "id" TEXT NOT NULL,
    "clubId" INTEGER NOT NULL,
    "outboxMessageId" TEXT NOT NULL,
    "senderId" TEXT,
    "templateMappingId" TEXT,
    "recipientRole" "NotificationRecipientRole" NOT NULL,
    "recipientPhone" TEXT NOT NULL,
    "eventType" "NotificationEventType" NOT NULL,
    "provider" "WhatsappProvider" NOT NULL,
    "providerMessageId" TEXT,
    "providerConversationId" TEXT,
    "status" "WhatsappDeliveryStatus" NOT NULL DEFAULT 'QUEUED',
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "rawRequest" JSONB,
    "rawResponse" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WhatsappDelivery_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WhatsappWebhookEvent" (
    "id" TEXT NOT NULL,
    "senderId" TEXT,
    "deliveryId" TEXT,
    "providerMessageId" TEXT,
    "providerEventId" TEXT,
    "eventType" TEXT NOT NULL,
    "status" "WhatsappDeliveryStatus",
    "rawPayload" JSONB NOT NULL,
    "processedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsappWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WhatsappSender_code_key" ON "WhatsappSender"("code");

CREATE INDEX "WhatsappSender_clubId_status_idx" ON "WhatsappSender"("clubId", "status");

CREATE INDEX "WhatsappSender_mode_status_idx" ON "WhatsappSender"("mode", "status");

CREATE UNIQUE INDEX "WhatsappTemplateMapping_senderId_eventType_recipientRole_languageCode_version_key"
ON "WhatsappTemplateMapping"("senderId", "eventType", "recipientRole", "languageCode", "version");

CREATE INDEX "WhatsappTemplateMapping_senderId_status_idx" ON "WhatsappTemplateMapping"("senderId", "status");

CREATE UNIQUE INDEX "WhatsappDelivery_outboxMessageId_key" ON "WhatsappDelivery"("outboxMessageId");

CREATE UNIQUE INDEX "WhatsappDelivery_providerMessageId_key" ON "WhatsappDelivery"("providerMessageId");

CREATE INDEX "WhatsappDelivery_clubId_status_createdAt_idx" ON "WhatsappDelivery"("clubId", "status", "createdAt");

CREATE INDEX "WhatsappDelivery_eventType_recipientRole_createdAt_idx"
ON "WhatsappDelivery"("eventType", "recipientRole", "createdAt");

CREATE INDEX "WhatsappDelivery_provider_providerMessageId_idx"
ON "WhatsappDelivery"("provider", "providerMessageId");

CREATE INDEX "WhatsappWebhookEvent_providerMessageId_idx" ON "WhatsappWebhookEvent"("providerMessageId");

CREATE INDEX "WhatsappWebhookEvent_providerEventId_idx" ON "WhatsappWebhookEvent"("providerEventId");

CREATE INDEX "WhatsappWebhookEvent_createdAt_idx" ON "WhatsappWebhookEvent"("createdAt");

ALTER TABLE "WhatsappSender"
ADD CONSTRAINT "WhatsappSender_clubId_fkey"
FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WhatsappTemplateMapping"
ADD CONSTRAINT "WhatsappTemplateMapping_senderId_fkey"
FOREIGN KEY ("senderId") REFERENCES "WhatsappSender"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WhatsappDelivery"
ADD CONSTRAINT "WhatsappDelivery_clubId_fkey"
FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WhatsappDelivery"
ADD CONSTRAINT "WhatsappDelivery_outboxMessageId_fkey"
FOREIGN KEY ("outboxMessageId") REFERENCES "OutboxMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WhatsappDelivery"
ADD CONSTRAINT "WhatsappDelivery_senderId_fkey"
FOREIGN KEY ("senderId") REFERENCES "WhatsappSender"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WhatsappDelivery"
ADD CONSTRAINT "WhatsappDelivery_templateMappingId_fkey"
FOREIGN KEY ("templateMappingId") REFERENCES "WhatsappTemplateMapping"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WhatsappWebhookEvent"
ADD CONSTRAINT "WhatsappWebhookEvent_senderId_fkey"
FOREIGN KEY ("senderId") REFERENCES "WhatsappSender"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WhatsappWebhookEvent"
ADD CONSTRAINT "WhatsappWebhookEvent_deliveryId_fkey"
FOREIGN KEY ("deliveryId") REFERENCES "WhatsappDelivery"("id") ON DELETE SET NULL ON UPDATE CASCADE;
