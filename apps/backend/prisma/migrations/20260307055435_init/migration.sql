-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'MEMBER', 'GUEST');

-- CreateEnum
CREATE TYPE "MembershipRole" AS ENUM ('OWNER', 'ADMIN', 'STAFF', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "BookingConfirmationMode" AS ENUM ('AUTOMATIC', 'MANUAL', 'DEPOSIT_REQUIRED');

-- CreateEnum
CREATE TYPE "ScheduleMode" AS ENUM ('FIXED', 'RANGE');

-- CreateEnum
CREATE TYPE "FixedBookingStatus" AS ENUM ('ACTIVE', 'PAUSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AccountSource" AS ENUM ('BOOKING', 'BAR', 'TABLE', 'MANUAL');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "AccountItemType" AS ENUM ('BOOKING', 'PRODUCT', 'SERVICE', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'TRANSFER', 'CARD', 'MERCADO_PAGO', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentSource" AS ENUM ('POS', 'ONLINE', 'BACKOFFICE');

-- CreateEnum
CREATE TYPE "CashMovementMethod" AS ENUM ('CASH', 'TRANSFER', 'CARD', 'MP');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('ACCOUNT_ITEM', 'PAYMENT', 'REFUND', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "LedgerReferenceType" AS ENUM ('ACCOUNT', 'ACCOUNT_ITEM', 'PAYMENT', 'REFUND', 'BOOKING', 'MANUAL');

-- CreateEnum
CREATE TYPE "LedgerDirection" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "LedgerAccount" AS ENUM ('CASH', 'BANK', 'CARD_CLEARING', 'ONLINE_GATEWAY', 'ACCOUNTS_RECEIVABLE', 'BOOKING_REVENUE', 'BAR_REVENUE', 'ADJUSTMENTS', 'EXPENSE');

-- CreateEnum
CREATE TYPE "CashShiftStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "CashMovementPosType" AS ENUM ('PAYMENT_IN', 'REFUND', 'WITHDRAW', 'DEPOSIT');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'MEMBER',
    "isProfessor" BOOLEAN NOT NULL DEFAULT false,
    "dni" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Club" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "addressLine" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "locationId" INTEGER,
    "contactInfo" TEXT NOT NULL,
    "phone" TEXT,
    "logoUrl" TEXT,
    "clubImageUrl" TEXT,
    "instagramUrl" TEXT,
    "facebookUrl" TEXT,
    "websiteUrl" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Club_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "clubId" INTEGER NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" SERIAL NOT NULL,
    "city" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Court" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "isIndoor" BOOLEAN NOT NULL,
    "surface" TEXT NOT NULL,
    "isUnderMaintenance" BOOLEAN NOT NULL DEFAULT false,
    "price" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "activityTypeId" INTEGER,
    "clubId" INTEGER NOT NULL,

    CONSTRAINT "Court_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourtPriceRule" (
    "id" SERIAL NOT NULL,
    "courtId" INTEGER NOT NULL,
    "clubId" INTEGER NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startMinutes" INTEGER NOT NULL,
    "endMinutes" INTEGER NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourtPriceRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityType" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "defaultDurationMinutes" INTEGER NOT NULL,
    "clubId" INTEGER NOT NULL,
    "scheduleMode" "ScheduleMode" NOT NULL DEFAULT 'FIXED',
    "scheduleOpenTime" TEXT,
    "scheduleCloseTime" TEXT,
    "scheduleIntervalMinutes" INTEGER,
    "scheduleDurations" JSONB,
    "scheduleFixedSlots" JSONB,

    CONSTRAINT "ActivityType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "clubId" INTEGER NOT NULL,
    "userId" INTEGER,
    "name" TEXT NOT NULL,
    "dni" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Booking" (
    "id" SERIAL NOT NULL,
    "startDateTime" TIMESTAMPTZ(3) NOT NULL,
    "endDateTime" TIMESTAMPTZ(3) NOT NULL,
    "cancelledBy" INTEGER,
    "cancelledAt" TIMESTAMPTZ(3),
    "autoCancelWarningSentAt" TIMESTAMPTZ(3),
    "autoCancelledAt" TIMESTAMPTZ(3),
    "autoCancelReason" TEXT,
    "price" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "BookingStatus" NOT NULL DEFAULT 'PENDING',
    "guestIdentifier" TEXT,
    "clientId" TEXT,
    "userId" INTEGER,
    "courtId" INTEGER NOT NULL,
    "activityId" INTEGER NOT NULL,
    "clubId" INTEGER NOT NULL,
    "fixedBookingId" INTEGER,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FixedBooking" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dayOfWeek" INTEGER NOT NULL,
    "startTimeMinutes" INTEGER NOT NULL,
    "endTimeMinutes" INTEGER NOT NULL,
    "startDate" TIMESTAMPTZ(3) NOT NULL,
    "status" "FixedBookingStatus" NOT NULL DEFAULT 'ACTIVE',
    "guestPhone" TEXT,
    "guestDni" TEXT,
    "guestName" TEXT,
    "userId" INTEGER,
    "courtId" INTEGER NOT NULL,
    "activityId" INTEGER NOT NULL,
    "clubId" INTEGER NOT NULL,

    CONSTRAINT "FixedBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "clubId" INTEGER NOT NULL,
    "sourceType" "AccountSource" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "status" "AccountStatus" NOT NULL DEFAULT 'OPEN',
    "totalAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "paidAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountItem" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "type" "AccountItemType" NOT NULL,
    "productId" INTEGER,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "total" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amount" DECIMAL(10,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "source" "PaymentSource" NOT NULL DEFAULT 'POS',
    "idempotencyKey" TEXT,
    "accountId" TEXT NOT NULL,
    "cashShiftId" TEXT,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAllocation" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amount" DECIMAL(10,2) NOT NULL,
    "accountId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "accountItemId" TEXT NOT NULL,

    CONSTRAINT "PaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerTransaction" (
    "id" TEXT NOT NULL,
    "clubId" INTEGER NOT NULL,
    "type" "LedgerEntryType" NOT NULL,
    "referenceType" "LedgerReferenceType" NOT NULL,
    "referenceId" TEXT NOT NULL,
    "createdByUserId" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "channel" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT,
    "sentAt" TIMESTAMPTZ(3),
    "userId" INTEGER,
    "clubId" INTEGER NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "clubId" INTEGER NOT NULL,
    "userId" INTEGER,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "clubId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxMessage" (
    "id" TEXT NOT NULL,
    "clubId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "aggregateType" TEXT,
    "aggregateId" TEXT,
    "payload" JSONB NOT NULL,
    "dedupeKey" TEXT,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMPTZ(3),
    "claimedBy" TEXT,
    "processedAt" TIMESTAMPTZ(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "OutboxMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountSummaryProjection" (
    "accountId" TEXT NOT NULL,
    "clubId" INTEGER NOT NULL,
    "sourceType" "AccountSource" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "status" "AccountStatus" NOT NULL,
    "totalAmount" DECIMAL(10,2) NOT NULL,
    "paidAmount" DECIMAL(10,2) NOT NULL,
    "remaining" DECIMAL(10,2) NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AccountSummaryProjection_pkey" PRIMARY KEY ("accountId")
);

-- CreateTable
CREATE TABLE "CashShiftSummaryProjection" (
    "shiftId" TEXT NOT NULL,
    "clubId" INTEGER NOT NULL,
    "cashRegisterId" TEXT NOT NULL,
    "status" "CashShiftStatus" NOT NULL,
    "openingAmount" DECIMAL(10,2) NOT NULL,
    "expectedCash" DECIMAL(10,2),
    "countedCash" DECIMAL(10,2),
    "difference" DECIMAL(10,2),
    "paymentIn" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "deposit" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "withdraw" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "refund" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CashShiftSummaryProjection_pkey" PRIMARY KEY ("shiftId")
);

-- CreateTable
CREATE TABLE "DailyCashSummaryProjection" (
    "clubId" INTEGER NOT NULL,
    "day" DATE NOT NULL,
    "cashIn" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "cashOut" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "netCash" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DailyCashSummaryProjection_pkey" PRIMARY KEY ("clubId","day")
);

-- CreateTable
CREATE TABLE "ClubSettings" (
    "id" SERIAL NOT NULL,
    "clubId" INTEGER NOT NULL,
    "timeZone" TEXT NOT NULL DEFAULT 'America/Argentina/Buenos_Aires',
    "openingDays" JSONB,
    "lightsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "lightsExtraAmount" DECIMAL(10,2),
    "lightsFromHour" TEXT,
    "professorDiscountEnabled" BOOLEAN NOT NULL DEFAULT false,
    "professorDiscountPercent" DECIMAL(5,2),
    "fixedBookingSettingsByActivity" JSONB,
    "bookingConfirmationMode" "BookingConfirmationMode" NOT NULL DEFAULT 'MANUAL',
    "bookingDepositPercent" DECIMAL(5,2),
    "allowManualConfirmationOverride" BOOLEAN NOT NULL DEFAULT true,
    "autoCancelPendingBookingsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "autoCancelPendingBookingsMinutesBefore" INTEGER,
    "autoCancelPendingBookingsOnlyIfUnpaid" BOOLEAN NOT NULL DEFAULT true,
    "autoCancelPendingWarningEnabled" BOOLEAN NOT NULL DEFAULT false,
    "autoCancelPendingWarningMinutesBefore" INTEGER,
    "enforceCashShiftCloseWithOpenAccounts" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ClubSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "price" DECIMAL(10,2) NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "isCombo" BOOLEAN NOT NULL DEFAULT false,
    "minStock" INTEGER NOT NULL DEFAULT 5,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "clubId" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductComponent" (
    "id" SERIAL NOT NULL,
    "parentProductId" INTEGER NOT NULL,
    "componentProductId" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "ProductComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashMovement" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" "CashMovementPosType" NOT NULL,
    "method" "CashMovementMethod" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "concept" TEXT NOT NULL,
    "cashShiftId" TEXT NOT NULL,
    "createdByUserId" INTEGER,
    "paymentId" TEXT,
    "refundId" TEXT,
    "clubId" INTEGER NOT NULL,

    CONSTRAINT "CashMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "clubId" INTEGER NOT NULL,
    "type" "LedgerEntryType" NOT NULL,
    "referenceType" "LedgerReferenceType" NOT NULL,
    "referenceId" TEXT NOT NULL,
    "accountId" TEXT,
    "accountItemId" TEXT,
    "paymentId" TEXT,
    "refundId" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "account" "LedgerAccount" NOT NULL,
    "direction" "LedgerDirection" NOT NULL,
    "description" TEXT NOT NULL,
    "createdByUserId" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashRegister" (
    "id" TEXT NOT NULL,
    "clubId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashRegister_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashShift" (
    "id" TEXT NOT NULL,
    "cashRegisterId" TEXT NOT NULL,
    "clubId" INTEGER NOT NULL,
    "openedByUserId" INTEGER,
    "closedByUserId" INTEGER,
    "openedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMPTZ(3),
    "openingAmount" DECIMAL(10,2) NOT NULL,
    "expectedCash" DECIMAL(10,2),
    "countedCash" DECIMAL(10,2),
    "difference" DECIMAL(10,2),
    "status" "CashShiftStatus" NOT NULL DEFAULT 'OPEN',

    CONSTRAINT "CashShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amount" DECIMAL(10,2) NOT NULL,
    "reason" TEXT,
    "paymentId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "clubId" INTEGER NOT NULL,
    "cashShiftId" TEXT,
    "createdByUserId" INTEGER,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Club_slug_key" ON "Club"("slug");

-- CreateIndex
CREATE INDEX "Membership_clubId_idx" ON "Membership"("clubId");

-- CreateIndex
CREATE INDEX "Membership_userId_idx" ON "Membership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_clubId_key" ON "Membership"("userId", "clubId");

-- CreateIndex
CREATE UNIQUE INDEX "Location_city_province_country_key" ON "Location"("city", "province", "country");

-- CreateIndex
CREATE INDEX "Court_clubId_idx" ON "Court"("clubId");

-- CreateIndex
CREATE INDEX "CourtPriceRule_courtId_idx" ON "CourtPriceRule"("courtId");

-- CreateIndex
CREATE INDEX "CourtPriceRule_clubId_idx" ON "CourtPriceRule"("clubId");

-- CreateIndex
CREATE INDEX "CourtPriceRule_courtId_dayOfWeek_idx" ON "CourtPriceRule"("courtId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "ActivityType_clubId_idx" ON "ActivityType"("clubId");

-- CreateIndex
CREATE INDEX "Client_clubId_idx" ON "Client"("clubId");

-- CreateIndex
CREATE INDEX "Client_userId_idx" ON "Client"("userId");

-- CreateIndex
CREATE INDEX "Client_clubId_dni_idx" ON "Client"("clubId", "dni");

-- CreateIndex
CREATE UNIQUE INDEX "Client_clubId_email_key" ON "Client"("clubId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Client_clubId_phone_key" ON "Client"("clubId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "Client_clubId_dni_key" ON "Client"("clubId", "dni");

-- CreateIndex
CREATE UNIQUE INDEX "Client_clubId_userId_key" ON "Client"("clubId", "userId");

-- CreateIndex
CREATE INDEX "booking_court_day" ON "Booking"("courtId", "startDateTime");

-- CreateIndex
CREATE INDEX "Booking_courtId_endDateTime_idx" ON "Booking"("courtId", "endDateTime");

-- CreateIndex
CREATE INDEX "booking_club_day" ON "Booking"("clubId", "startDateTime");

-- CreateIndex
CREATE INDEX "booking_activity_day" ON "Booking"("activityId", "startDateTime");

-- CreateIndex
CREATE INDEX "Booking_startDateTime_idx" ON "Booking"("startDateTime");

-- CreateIndex
CREATE INDEX "booking_pending_autocancel_idx" ON "Booking"("status", "startDateTime", "autoCancelledAt");

-- CreateIndex
CREATE INDEX "FixedBooking_courtId_dayOfWeek_idx" ON "FixedBooking"("courtId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "FixedBooking_clubId_idx" ON "FixedBooking"("clubId");

-- CreateIndex
CREATE INDEX "Account_clubId_idx" ON "Account"("clubId");

-- CreateIndex
CREATE INDEX "Account_sourceType_sourceId_idx" ON "Account"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "Account_status_createdAt_idx" ON "Account"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Account_idempotencyKey_idx" ON "Account"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Account_clubId_sourceType_sourceId_key" ON "Account"("clubId", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "AccountItem_accountId_idx" ON "AccountItem"("accountId");

-- CreateIndex
CREATE INDEX "AccountItem_productId_idx" ON "AccountItem"("productId");

-- CreateIndex
CREATE INDEX "Payment_accountId_idx" ON "Payment"("accountId");

-- CreateIndex
CREATE INDEX "Payment_source_idx" ON "Payment"("source");

-- CreateIndex
CREATE INDEX "Payment_cashShiftId_idx" ON "Payment"("cashShiftId");

-- CreateIndex
CREATE INDEX "Payment_idempotencyKey_idx" ON "Payment"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_accountId_idempotencyKey_key" ON "Payment"("accountId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "PaymentAllocation_accountId_createdAt_idx" ON "PaymentAllocation"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentAllocation_accountItemId_createdAt_idx" ON "PaymentAllocation"("accountItemId", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentAllocation_paymentId_createdAt_idx" ON "PaymentAllocation"("paymentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAllocation_paymentId_accountItemId_key" ON "PaymentAllocation"("paymentId", "accountItemId");

-- CreateIndex
CREATE INDEX "LedgerTransaction_clubId_createdAt_idx" ON "LedgerTransaction"("clubId", "createdAt");

-- CreateIndex
CREATE INDEX "LedgerTransaction_referenceType_referenceId_idx" ON "LedgerTransaction"("referenceType", "referenceId");

-- CreateIndex
CREATE INDEX "Notification_clubId_idx" ON "Notification"("clubId");

-- CreateIndex
CREATE INDEX "Notification_clubId_createdAt_idx" ON "Notification"("clubId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_idx" ON "Notification"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_clubId_idx" ON "AuditLog"("clubId");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "Event_clubId_idx" ON "Event"("clubId");

-- CreateIndex
CREATE INDEX "Event_type_idx" ON "Event"("type");

-- CreateIndex
CREATE UNIQUE INDEX "OutboxMessage_dedupeKey_key" ON "OutboxMessage"("dedupeKey");

-- CreateIndex
CREATE INDEX "OutboxMessage_clubId_createdAt_idx" ON "OutboxMessage"("clubId", "createdAt");

-- CreateIndex
CREATE INDEX "OutboxMessage_type_status_idx" ON "OutboxMessage"("type", "status");

-- CreateIndex
CREATE INDEX "OutboxMessage_status_availableAt_createdAt_idx" ON "OutboxMessage"("status", "availableAt", "createdAt");

-- CreateIndex
CREATE INDEX "AccountSummaryProjection_clubId_status_idx" ON "AccountSummaryProjection"("clubId", "status");

-- CreateIndex
CREATE INDEX "AccountSummaryProjection_clubId_updatedAt_idx" ON "AccountSummaryProjection"("clubId", "updatedAt");

-- CreateIndex
CREATE INDEX "CashShiftSummaryProjection_clubId_status_idx" ON "CashShiftSummaryProjection"("clubId", "status");

-- CreateIndex
CREATE INDEX "CashShiftSummaryProjection_clubId_updatedAt_idx" ON "CashShiftSummaryProjection"("clubId", "updatedAt");

-- CreateIndex
CREATE INDEX "DailyCashSummaryProjection_day_idx" ON "DailyCashSummaryProjection"("day");

-- CreateIndex
CREATE UNIQUE INDEX "ClubSettings_clubId_key" ON "ClubSettings"("clubId");

-- CreateIndex
CREATE INDEX "Product_clubId_idx" ON "Product"("clubId");

-- CreateIndex
CREATE INDEX "ProductComponent_parentProductId_idx" ON "ProductComponent"("parentProductId");

-- CreateIndex
CREATE INDEX "ProductComponent_componentProductId_idx" ON "ProductComponent"("componentProductId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductComponent_parentProductId_componentProductId_key" ON "ProductComponent"("parentProductId", "componentProductId");

-- CreateIndex
CREATE UNIQUE INDEX "CashMovement_paymentId_key" ON "CashMovement"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "CashMovement_refundId_key" ON "CashMovement"("refundId");

-- CreateIndex
CREATE INDEX "CashMovement_clubId_createdAt_idx" ON "CashMovement"("clubId", "createdAt");

-- CreateIndex
CREATE INDEX "CashMovement_paymentId_idx" ON "CashMovement"("paymentId");

-- CreateIndex
CREATE INDEX "CashMovement_refundId_idx" ON "CashMovement"("refundId");

-- CreateIndex
CREATE INDEX "CashMovement_cashShiftId_idx" ON "CashMovement"("cashShiftId");

-- CreateIndex
CREATE INDEX "LedgerEntry_transactionId_idx" ON "LedgerEntry"("transactionId");

-- CreateIndex
CREATE INDEX "LedgerEntry_account_createdAt_idx" ON "LedgerEntry"("account", "createdAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_clubId_createdAt_idx" ON "LedgerEntry"("clubId", "createdAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_accountId_createdAt_idx" ON "LedgerEntry"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_referenceType_referenceId_idx" ON "LedgerEntry"("referenceType", "referenceId");

-- CreateIndex
CREATE INDEX "CashRegister_clubId_idx" ON "CashRegister"("clubId");

-- CreateIndex
CREATE UNIQUE INDEX "CashRegister_clubId_name_key" ON "CashRegister"("clubId", "name");

-- CreateIndex
CREATE INDEX "CashShift_cashRegisterId_idx" ON "CashShift"("cashRegisterId");

-- CreateIndex
CREATE INDEX "CashShift_status_idx" ON "CashShift"("status");

-- CreateIndex
CREATE INDEX "CashShift_clubId_idx" ON "CashShift"("clubId");

-- CreateIndex
CREATE INDEX "CashShift_openedAt_idx" ON "CashShift"("openedAt");

-- CreateIndex
CREATE INDEX "CashShift_clubId_status_idx" ON "CashShift"("clubId", "status");

-- CreateIndex
CREATE INDEX "Refund_paymentId_idx" ON "Refund"("paymentId");

-- CreateIndex
CREATE INDEX "Refund_accountId_idx" ON "Refund"("accountId");

-- CreateIndex
CREATE INDEX "Refund_clubId_createdAt_idx" ON "Refund"("clubId", "createdAt");

-- CreateIndex
CREATE INDEX "Refund_cashShiftId_idx" ON "Refund"("cashShiftId");

-- AddForeignKey
ALTER TABLE "Club" ADD CONSTRAINT "Club_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Court" ADD CONSTRAINT "Court_activityTypeId_fkey" FOREIGN KEY ("activityTypeId") REFERENCES "ActivityType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Court" ADD CONSTRAINT "Court_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourtPriceRule" ADD CONSTRAINT "CourtPriceRule_courtId_fkey" FOREIGN KEY ("courtId") REFERENCES "Court"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourtPriceRule" ADD CONSTRAINT "CourtPriceRule_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityType" ADD CONSTRAINT "ActivityType_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_courtId_fkey" FOREIGN KEY ("courtId") REFERENCES "Court"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "ActivityType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_fixedBookingId_fkey" FOREIGN KEY ("fixedBookingId") REFERENCES "FixedBooking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixedBooking" ADD CONSTRAINT "FixedBooking_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixedBooking" ADD CONSTRAINT "FixedBooking_courtId_fkey" FOREIGN KEY ("courtId") REFERENCES "Court"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixedBooking" ADD CONSTRAINT "FixedBooking_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "ActivityType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixedBooking" ADD CONSTRAINT "FixedBooking_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountItem" ADD CONSTRAINT "AccountItem_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountItem" ADD CONSTRAINT "AccountItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_accountItemId_fkey" FOREIGN KEY ("accountItemId") REFERENCES "AccountItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_cashShiftId_fkey" FOREIGN KEY ("cashShiftId") REFERENCES "CashShift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerTransaction" ADD CONSTRAINT "LedgerTransaction_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerTransaction" ADD CONSTRAINT "LedgerTransaction_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboxMessage" ADD CONSTRAINT "OutboxMessage_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubSettings" ADD CONSTRAINT "ClubSettings_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductComponent" ADD CONSTRAINT "ProductComponent_parentProductId_fkey" FOREIGN KEY ("parentProductId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductComponent" ADD CONSTRAINT "ProductComponent_componentProductId_fkey" FOREIGN KEY ("componentProductId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_cashShiftId_fkey" FOREIGN KEY ("cashShiftId") REFERENCES "CashShift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "Refund"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "LedgerTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_accountItemId_fkey" FOREIGN KEY ("accountItemId") REFERENCES "AccountItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "Refund"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashRegister" ADD CONSTRAINT "CashRegister_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashShift" ADD CONSTRAINT "CashShift_cashRegisterId_fkey" FOREIGN KEY ("cashRegisterId") REFERENCES "CashRegister"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashShift" ADD CONSTRAINT "CashShift_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashShift" ADD CONSTRAINT "CashShift_openedByUserId_fkey" FOREIGN KEY ("openedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashShift" ADD CONSTRAINT "CashShift_closedByUserId_fkey" FOREIGN KEY ("closedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_cashShiftId_fkey" FOREIGN KEY ("cashShiftId") REFERENCES "CashShift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


