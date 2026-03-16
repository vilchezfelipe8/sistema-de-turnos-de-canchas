-- CreateEnum
CREATE TYPE "FiscalMode" AS ENUM ('REQUIRED', 'ON_DEMAND', 'NONE');

-- CreateEnum
CREATE TYPE "FiscalStatus" AS ENUM ('NOT_APPLICABLE', 'PENDING', 'AUTHORIZED', 'REJECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "FiscalProvider" AS ENUM ('ARCA', 'MANUAL', 'OTHER');

-- CreateEnum
CREATE TYPE "FiscalDocumentType" AS ENUM ('INVOICE_B', 'INVOICE_C', 'CREDIT_NOTE_B', 'CREDIT_NOTE_C', 'DEBIT_NOTE_B', 'DEBIT_NOTE_C', 'RECEIPT_X');

-- CreateEnum
CREATE TYPE "FiscalDocumentStatus" AS ENUM ('PENDING', 'PROCESSING', 'AUTHORIZED', 'REJECTED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('MERCADOPAGO', 'BANK_TRANSFER', 'MANUAL_POS', 'OTHER');

-- CreateEnum
CREATE TYPE "ProviderAccountStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ERROR');

-- CreateEnum
CREATE TYPE "GatewayTransactionType" AS ENUM ('PAYMENT', 'REFUND', 'CHARGEBACK', 'REVERSAL');

-- CreateEnum
CREATE TYPE "GatewayTransactionStatus" AS ENUM ('PENDING', 'IN_PROCESS', 'APPROVED', 'REJECTED', 'CANCELLED', 'REFUNDED', 'FAILED');

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "fiscalDocumentId" TEXT,
ADD COLUMN     "fiscalMode" "FiscalMode" NOT NULL DEFAULT 'ON_DEMAND',
ADD COLUMN     "fiscalStatus" "FiscalStatus" NOT NULL DEFAULT 'NOT_APPLICABLE',
ADD COLUMN     "providerAccountId" TEXT;

-- AlterTable
ALTER TABLE "Refund" ADD COLUMN     "fiscalDocumentId" TEXT,
ADD COLUMN     "fiscalMode" "FiscalMode" NOT NULL DEFAULT 'ON_DEMAND',
ADD COLUMN     "fiscalStatus" "FiscalStatus" NOT NULL DEFAULT 'NOT_APPLICABLE';

-- CreateTable
CREATE TABLE "PaymentProviderAccount" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "clubId" INTEGER NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "status" "ProviderAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "displayName" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "externalMerchantId" TEXT,
    "accountAlias" TEXT,
    "accountCbu" TEXT,
    "accountCvu" TEXT,
    "credentialsEncrypted" JSONB,
    "webhookSecretEncrypted" TEXT,
    "tokenExpiresAt" TIMESTAMPTZ(3),
    "lastSyncAt" TIMESTAMPTZ(3),
    "lastError" TEXT,

    CONSTRAINT "PaymentProviderAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GatewayTransaction" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "occurredAt" TIMESTAMPTZ(3),
    "settledAt" TIMESTAMPTZ(3),
    "clubId" INTEGER NOT NULL,
    "providerAccountId" TEXT,
    "provider" "PaymentProvider" NOT NULL,
    "type" "GatewayTransactionType" NOT NULL,
    "status" "GatewayTransactionStatus" NOT NULL DEFAULT 'PENDING',
    "externalId" TEXT NOT NULL,
    "externalReference" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "netAmount" DECIMAL(10,2),
    "feeAmount" DECIMAL(10,2),
    "currency" TEXT NOT NULL DEFAULT 'ARS',
    "paymentId" TEXT,
    "refundId" TEXT,
    "rawPayload" JSONB,
    "reconciliationNotes" TEXT,

    CONSTRAINT "GatewayTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiscalDocument" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "clubId" INTEGER NOT NULL,
    "accountId" TEXT,
    "provider" "FiscalProvider" NOT NULL DEFAULT 'ARCA',
    "type" "FiscalDocumentType" NOT NULL,
    "status" "FiscalDocumentStatus" NOT NULL DEFAULT 'PENDING',
    "pointOfSale" INTEGER,
    "documentNumber" INTEGER,
    "cae" TEXT,
    "caeExpiresAt" TIMESTAMPTZ(3),
    "authorizedAt" TIMESTAMPTZ(3),
    "totalAmount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'ARS',
    "requestPayload" JSONB,
    "responsePayload" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMPTZ(3),

    CONSTRAINT "FiscalDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentProviderAccount_clubId_provider_status_idx" ON "PaymentProviderAccount"("clubId", "provider", "status");

-- CreateIndex
CREATE INDEX "PaymentProviderAccount_clubId_isDefault_idx" ON "PaymentProviderAccount"("clubId", "isDefault");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentProviderAccount_clubId_provider_externalMerchantId_key" ON "PaymentProviderAccount"("clubId", "provider", "externalMerchantId");

-- CreateIndex
CREATE INDEX "GatewayTransaction_clubId_createdAt_idx" ON "GatewayTransaction"("clubId", "createdAt");

-- CreateIndex
CREATE INDEX "GatewayTransaction_providerAccountId_status_createdAt_idx" ON "GatewayTransaction"("providerAccountId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "GatewayTransaction_paymentId_idx" ON "GatewayTransaction"("paymentId");

-- CreateIndex
CREATE INDEX "GatewayTransaction_refundId_idx" ON "GatewayTransaction"("refundId");

-- CreateIndex
CREATE UNIQUE INDEX "GatewayTransaction_provider_externalId_key" ON "GatewayTransaction"("provider", "externalId");

-- CreateIndex
CREATE INDEX "FiscalDocument_clubId_status_createdAt_idx" ON "FiscalDocument"("clubId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "FiscalDocument_provider_createdAt_idx" ON "FiscalDocument"("provider", "createdAt");

-- CreateIndex
CREATE INDEX "FiscalDocument_accountId_idx" ON "FiscalDocument"("accountId");

-- CreateIndex
CREATE INDEX "FiscalDocument_cae_idx" ON "FiscalDocument"("cae");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_fiscalDocumentId_key" ON "Payment"("fiscalDocumentId");

-- CreateIndex
CREATE INDEX "Payment_providerAccountId_idx" ON "Payment"("providerAccountId");

-- CreateIndex
CREATE INDEX "Payment_fiscalStatus_idx" ON "Payment"("fiscalStatus");

-- CreateIndex
CREATE INDEX "Payment_fiscalDocumentId_idx" ON "Payment"("fiscalDocumentId");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_fiscalDocumentId_key" ON "Refund"("fiscalDocumentId");

-- CreateIndex
CREATE INDEX "Refund_fiscalStatus_idx" ON "Refund"("fiscalStatus");

-- CreateIndex
CREATE INDEX "Refund_fiscalDocumentId_idx" ON "Refund"("fiscalDocumentId");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_providerAccountId_fkey" FOREIGN KEY ("providerAccountId") REFERENCES "PaymentProviderAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_fiscalDocumentId_fkey" FOREIGN KEY ("fiscalDocumentId") REFERENCES "FiscalDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_fiscalDocumentId_fkey" FOREIGN KEY ("fiscalDocumentId") REFERENCES "FiscalDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentProviderAccount" ADD CONSTRAINT "PaymentProviderAccount_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GatewayTransaction" ADD CONSTRAINT "GatewayTransaction_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GatewayTransaction" ADD CONSTRAINT "GatewayTransaction_providerAccountId_fkey" FOREIGN KEY ("providerAccountId") REFERENCES "PaymentProviderAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GatewayTransaction" ADD CONSTRAINT "GatewayTransaction_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GatewayTransaction" ADD CONSTRAINT "GatewayTransaction_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "Refund"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalDocument" ADD CONSTRAINT "FiscalDocument_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalDocument" ADD CONSTRAINT "FiscalDocument_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

