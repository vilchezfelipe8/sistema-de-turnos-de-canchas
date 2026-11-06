-- CreateEnum
CREATE TYPE "SubscriptionBillingType" AS ENUM ('RECURRING', 'FIXED_TERM');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'PAUSED', 'PAST_DUE', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SubscriptionInstallmentKind" AS ENUM ('ENROLLMENT_FEE', 'PERIOD');

-- CreateEnum
CREATE TYPE "SubscriptionInstallmentStatus" AS ENUM ('PENDING', 'PAID', 'VOID');

-- CreateEnum
CREATE TYPE "SubscriptionEntitlementKind" AS ENUM ('ACTIVITY_ACCESS', 'CLASS_CREDITS');

-- AlterEnum
ALTER TYPE "AccountSource" ADD VALUE 'SUBSCRIPTION_INSTALLMENT';

-- AlterEnum
ALTER TYPE "LedgerReferenceType" ADD VALUE 'SUBSCRIPTION';

-- AlterEnum
ALTER TYPE "LedgerAccount" ADD VALUE 'MEMBERSHIP_REVENUE';

-- AlterTable
ALTER TABLE "ClassPass" ADD COLUMN     "subscriptionId" TEXT;

-- CreateTable
CREATE TABLE "SubscriptionPlan" (
    "id" TEXT NOT NULL,
    "clubId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "billingType" "SubscriptionBillingType" NOT NULL,
    "periodMonths" INTEGER NOT NULL,
    "enrollmentFee" DECIMAL(10,2),
    "dueDayOfMonth" INTEGER,
    "graceDays" INTEGER NOT NULL DEFAULT 5,
    "pauseMaxDays" INTEGER NOT NULL DEFAULT 0,
    "pauseMaxCount" INTEGER NOT NULL DEFAULT 0,
    "grantsMemberCategoryId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SubscriptionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionPlanOption" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "installmentsCount" INTEGER NOT NULL,
    "installmentPrice" DECIMAL(10,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SubscriptionPlanOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionPlanEntitlement" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "kind" "SubscriptionEntitlementKind" NOT NULL,
    "activityTypeId" INTEGER NOT NULL,
    "timesPerWeek" INTEGER,
    "creditsPerPeriod" INTEGER,
    "classType" "ClassSessionType",

    CONSTRAINT "SubscriptionPlanEntitlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "clubId" INTEGER NOT NULL,
    "planId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "payerClientId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "planSnapshot" JSONB NOT NULL,
    "priceLocked" BOOLEAN NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "currentPeriodEnd" DATE NOT NULL,
    "autoRenew" BOOLEAN NOT NULL DEFAULT true,
    "pausesUsed" INTEGER NOT NULL DEFAULT 0,
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelReason" TEXT,
    "notes" TEXT,
    "createdByUserId" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionInstallment" (
    "id" TEXT NOT NULL,
    "clubId" INTEGER NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "kind" "SubscriptionInstallmentKind" NOT NULL,
    "coversFrom" DATE NOT NULL,
    "coversTo" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "listAmount" DECIMAL(10,2) NOT NULL,
    "status" "SubscriptionInstallmentStatus" NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMPTZ(3),
    "accountId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SubscriptionInstallment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionPause" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "reason" TEXT,
    "createdByUserId" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionPause_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionHistory" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "clubId" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "fromStatus" "SubscriptionStatus",
    "toStatus" "SubscriptionStatus",
    "detail" JSONB,
    "changedByUserId" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SubscriptionPlan_clubId_isActive_idx" ON "SubscriptionPlan"("clubId", "isActive");

-- CreateIndex
CREATE INDEX "SubscriptionPlanOption_planId_idx" ON "SubscriptionPlanOption"("planId");

-- CreateIndex
CREATE INDEX "SubscriptionPlanEntitlement_planId_idx" ON "SubscriptionPlanEntitlement"("planId");

-- CreateIndex
CREATE INDEX "SubscriptionPlanEntitlement_activityTypeId_idx" ON "SubscriptionPlanEntitlement"("activityTypeId");

-- CreateIndex
CREATE INDEX "Subscription_clubId_status_idx" ON "Subscription"("clubId", "status");

-- CreateIndex
CREATE INDEX "Subscription_clubId_clientId_idx" ON "Subscription"("clubId", "clientId");

-- CreateIndex
CREATE INDEX "Subscription_clubId_payerClientId_idx" ON "Subscription"("clubId", "payerClientId");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionInstallment_accountId_key" ON "SubscriptionInstallment"("accountId");

-- CreateIndex
CREATE INDEX "SubscriptionInstallment_clubId_status_dueDate_idx" ON "SubscriptionInstallment"("clubId", "status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionInstallment_subscriptionId_sequence_key" ON "SubscriptionInstallment"("subscriptionId", "sequence");

-- CreateIndex
CREATE INDEX "SubscriptionPause_subscriptionId_idx" ON "SubscriptionPause"("subscriptionId");

-- CreateIndex
CREATE INDEX "SubscriptionHistory_subscriptionId_createdAt_idx" ON "SubscriptionHistory"("subscriptionId", "createdAt");

-- CreateIndex
CREATE INDEX "SubscriptionHistory_clubId_createdAt_idx" ON "SubscriptionHistory"("clubId", "createdAt");

-- AddForeignKey
ALTER TABLE "ClassPass" ADD CONSTRAINT "ClassPass_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionPlan" ADD CONSTRAINT "SubscriptionPlan_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionPlan" ADD CONSTRAINT "SubscriptionPlan_grantsMemberCategoryId_fkey" FOREIGN KEY ("grantsMemberCategoryId") REFERENCES "MemberCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionPlanOption" ADD CONSTRAINT "SubscriptionPlanOption_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionPlanEntitlement" ADD CONSTRAINT "SubscriptionPlanEntitlement_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionPlanEntitlement" ADD CONSTRAINT "SubscriptionPlanEntitlement_activityTypeId_fkey" FOREIGN KEY ("activityTypeId") REFERENCES "ActivityType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "SubscriptionPlanOption"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_payerClientId_fkey" FOREIGN KEY ("payerClientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionInstallment" ADD CONSTRAINT "SubscriptionInstallment_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionInstallment" ADD CONSTRAINT "SubscriptionInstallment_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionPause" ADD CONSTRAINT "SubscriptionPause_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionHistory" ADD CONSTRAINT "SubscriptionHistory_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

