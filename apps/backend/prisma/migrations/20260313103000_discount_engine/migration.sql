CREATE TYPE "DiscountScope" AS ENUM ('BOOKING', 'PRODUCT', 'SERVICE', 'ALL');
CREATE TYPE "DiscountAmountType" AS ENUM ('PERCENT', 'FIXED');
CREATE TYPE "DiscountApplyMode" AS ENUM ('INCLUDE_ONLY', 'EXCLUDE_LIST');

CREATE TABLE "DiscountPolicy" (
  "id" TEXT NOT NULL,
  "clubId" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "scope" "DiscountScope" NOT NULL,
  "amountType" "DiscountAmountType" NOT NULL,
  "amountValue" DECIMAL(10,2) NOT NULL,
  "applyMode" "DiscountApplyMode" NOT NULL DEFAULT 'INCLUDE_ONLY',
  "isStackable" BOOLEAN NOT NULL DEFAULT false,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "startsAt" TIMESTAMPTZ(3),
  "endsAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "DiscountPolicy_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DiscountPolicy_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "DiscountPolicyTarget" (
  "id" TEXT NOT NULL,
  "policyId" TEXT NOT NULL,
  "activityTypeId" INTEGER,
  "productId" INTEGER,
  "productCategory" TEXT,
  "serviceCode" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DiscountPolicyTarget_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DiscountPolicyTarget_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "DiscountPolicy"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DiscountPolicyTarget_activityTypeId_fkey" FOREIGN KEY ("activityTypeId") REFERENCES "ActivityType"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "DiscountPolicyTarget_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "ClientDiscountAssignment" (
  "id" TEXT NOT NULL,
  "clubId" INTEGER NOT NULL,
  "clientId" TEXT NOT NULL,
  "policyId" TEXT NOT NULL,
  "notes" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "startsAt" TIMESTAMPTZ(3),
  "endsAt" TIMESTAMPTZ(3),
  "createdByUserId" INTEGER,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ClientDiscountAssignment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ClientDiscountAssignment_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ClientDiscountAssignment_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ClientDiscountAssignment_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "DiscountPolicy"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ClientDiscountAssignment_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "AccountItemDiscount" (
  "id" TEXT NOT NULL,
  "clubId" INTEGER NOT NULL,
  "accountItemId" TEXT NOT NULL,
  "clientId" TEXT,
  "policyId" TEXT NOT NULL,
  "scope" "DiscountScope" NOT NULL,
  "amountType" "DiscountAmountType" NOT NULL,
  "amountValue" DECIMAL(10,2) NOT NULL,
  "baseAmount" DECIMAL(10,2) NOT NULL,
  "discountAmount" DECIMAL(10,2) NOT NULL,
  "finalAmount" DECIMAL(10,2) NOT NULL,
  "appliedByUserId" INTEGER,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccountItemDiscount_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AccountItemDiscount_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AccountItemDiscount_accountItemId_fkey" FOREIGN KEY ("accountItemId") REFERENCES "AccountItem"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AccountItemDiscount_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "AccountItemDiscount_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "DiscountPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AccountItemDiscount_appliedByUserId_fkey" FOREIGN KEY ("appliedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "DiscountPolicy_clubId_isActive_priority_idx" ON "DiscountPolicy"("clubId", "isActive", "priority");
CREATE INDEX "DiscountPolicy_clubId_scope_isActive_idx" ON "DiscountPolicy"("clubId", "scope", "isActive");
CREATE INDEX "DiscountPolicyTarget_policyId_idx" ON "DiscountPolicyTarget"("policyId");
CREATE INDEX "DiscountPolicyTarget_activityTypeId_idx" ON "DiscountPolicyTarget"("activityTypeId");
CREATE INDEX "DiscountPolicyTarget_productId_idx" ON "DiscountPolicyTarget"("productId");
CREATE INDEX "ClientDiscountAssignment_clubId_clientId_isActive_idx" ON "ClientDiscountAssignment"("clubId", "clientId", "isActive");
CREATE INDEX "ClientDiscountAssignment_policyId_isActive_idx" ON "ClientDiscountAssignment"("policyId", "isActive");
CREATE INDEX "AccountItemDiscount_clubId_createdAt_idx" ON "AccountItemDiscount"("clubId", "createdAt");
CREATE INDEX "AccountItemDiscount_accountItemId_idx" ON "AccountItemDiscount"("accountItemId");
CREATE INDEX "AccountItemDiscount_clientId_idx" ON "AccountItemDiscount"("clientId");
CREATE INDEX "AccountItemDiscount_policyId_idx" ON "AccountItemDiscount"("policyId");
CREATE UNIQUE INDEX "AccountItemDiscount_accountItemId_policyId_key" ON "AccountItemDiscount"("accountItemId", "policyId");
