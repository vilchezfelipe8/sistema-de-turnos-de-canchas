-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('MERCADO_PAGO');

-- CreateEnum
CREATE TYPE "PaymentIntegrationStatus" AS ENUM ('CONNECTED', 'DISCONNECTED', 'EXPIRED', 'ERROR');

-- CreateEnum
CREATE TYPE "OnlinePaymentAttemptStatus" AS ENUM ('CREATED', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'ERROR');

-- CreateTable
CREATE TABLE "ClubPaymentIntegration" (
    "id" TEXT NOT NULL,
    "clubId" INTEGER NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "status" "PaymentIntegrationStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "accessTokenEnc" TEXT,
    "refreshTokenEnc" TEXT,
    "publicKey" TEXT,
    "externalUserId" TEXT,
    "expiresAt" TIMESTAMPTZ(3),
    "connectedById" INTEGER,
    "disconnectedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ClubPaymentIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentProviderOAuthState" (
    "id" TEXT NOT NULL,
    "clubId" INTEGER NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "userId" INTEGER NOT NULL,
    "integrationId" TEXT,
    "nonce" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "consumedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentProviderOAuthState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnlinePaymentAttempt" (
    "id" TEXT NOT NULL,
    "clubId" INTEGER NOT NULL,
    "bookingId" INTEGER NOT NULL,
    "accountId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "integrationId" TEXT,
    "provider" "PaymentProvider" NOT NULL,
    "status" "OnlinePaymentAttemptStatus" NOT NULL DEFAULT 'CREATED',
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "externalReference" TEXT NOT NULL,
    "providerPreferenceId" TEXT,
    "providerPaymentId" TEXT,
    "initPoint" TEXT,
    "providerStatus" TEXT,
    "paymentId" TEXT,
    "failureReason" TEXT,
    "rawProviderData" JSONB,
    "processedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "OnlinePaymentAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClubPaymentIntegration_clubId_provider_key" ON "ClubPaymentIntegration"("clubId", "provider");

-- CreateIndex
CREATE INDEX "ClubPaymentIntegration_provider_status_idx" ON "ClubPaymentIntegration"("provider", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentProviderOAuthState_nonce_key" ON "PaymentProviderOAuthState"("nonce");

-- CreateIndex
CREATE INDEX "PaymentProviderOAuthState_clubId_provider_expiresAt_idx" ON "PaymentProviderOAuthState"("clubId", "provider", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "OnlinePaymentAttempt_externalReference_key" ON "OnlinePaymentAttempt"("externalReference");

-- CreateIndex
CREATE UNIQUE INDEX "OnlinePaymentAttempt_paymentId_key" ON "OnlinePaymentAttempt"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "OnlinePaymentAttempt_clubId_idempotencyKey_key" ON "OnlinePaymentAttempt"("clubId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "OnlinePaymentAttempt_bookingId_status_idx" ON "OnlinePaymentAttempt"("bookingId", "status");

-- CreateIndex
CREATE INDEX "OnlinePaymentAttempt_accountId_status_idx" ON "OnlinePaymentAttempt"("accountId", "status");

-- CreateIndex
CREATE INDEX "OnlinePaymentAttempt_provider_status_idx" ON "OnlinePaymentAttempt"("provider", "status");

-- CreateIndex
CREATE INDEX "OnlinePaymentAttempt_providerPaymentId_idx" ON "OnlinePaymentAttempt"("providerPaymentId");

-- AddForeignKey
ALTER TABLE "ClubPaymentIntegration"
ADD CONSTRAINT "ClubPaymentIntegration_clubId_fkey"
FOREIGN KEY ("clubId") REFERENCES "Club"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubPaymentIntegration"
ADD CONSTRAINT "ClubPaymentIntegration_connectedById_fkey"
FOREIGN KEY ("connectedById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentProviderOAuthState"
ADD CONSTRAINT "PaymentProviderOAuthState_clubId_fkey"
FOREIGN KEY ("clubId") REFERENCES "Club"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentProviderOAuthState"
ADD CONSTRAINT "PaymentProviderOAuthState_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentProviderOAuthState"
ADD CONSTRAINT "PaymentProviderOAuthState_integrationId_fkey"
FOREIGN KEY ("integrationId") REFERENCES "ClubPaymentIntegration"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnlinePaymentAttempt"
ADD CONSTRAINT "OnlinePaymentAttempt_clubId_fkey"
FOREIGN KEY ("clubId") REFERENCES "Club"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnlinePaymentAttempt"
ADD CONSTRAINT "OnlinePaymentAttempt_bookingId_fkey"
FOREIGN KEY ("bookingId") REFERENCES "Booking"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnlinePaymentAttempt"
ADD CONSTRAINT "OnlinePaymentAttempt_accountId_fkey"
FOREIGN KEY ("accountId") REFERENCES "Account"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnlinePaymentAttempt"
ADD CONSTRAINT "OnlinePaymentAttempt_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnlinePaymentAttempt"
ADD CONSTRAINT "OnlinePaymentAttempt_integrationId_fkey"
FOREIGN KEY ("integrationId") REFERENCES "ClubPaymentIntegration"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnlinePaymentAttempt"
ADD CONSTRAINT "OnlinePaymentAttempt_paymentId_fkey"
FOREIGN KEY ("paymentId") REFERENCES "Payment"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
