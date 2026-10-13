-- AlterEnum
ALTER TYPE "NotificationEventType" ADD VALUE 'ACCOUNT_VERIFICATION_CODE';

-- CreateEnum
CREATE TYPE "UserAccountStatus" AS ENUM ('ACTIVE', 'PENDING_ACTIVATION', 'DISABLED');

-- CreateEnum
CREATE TYPE "UserVerificationPurpose" AS ENUM ('ACTIVATION', 'PASSWORD_RESET');

-- CreateEnum
CREATE TYPE "UserVerificationChannel" AS ENUM ('WHATSAPP', 'EMAIL', 'ADMIN_ISSUED');

-- CreateEnum
CREATE TYPE "ClubMemberStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'INACTIVE');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "accountStatus" "UserAccountStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "createdByClubId" INTEGER,
ALTER COLUMN "email" DROP NOT NULL;

-- AlterTable
ALTER TABLE "ClubSettings" ADD COLUMN     "membersEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "onlineCheckoutEnabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "UserVerificationCode" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "purpose" "UserVerificationPurpose" NOT NULL,
    "channel" "UserVerificationChannel" NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "consumedAt" TIMESTAMPTZ(3),
    "issuedByUserId" INTEGER,
    "issuedForClubId" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserVerificationCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberCategory" (
    "id" TEXT NOT NULL,
    "clubId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MemberCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClubMember" (
    "id" TEXT NOT NULL,
    "clubId" INTEGER NOT NULL,
    "clientId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "memberNumber" TEXT,
    "status" "ClubMemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "joinedAt" DATE NOT NULL,
    "validUntil" DATE,
    "leftAt" DATE,
    "statusReason" TEXT,
    "notes" TEXT,
    "createdByUserId" INTEGER,
    "updatedByUserId" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ClubMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClubMemberHistory" (
    "id" TEXT NOT NULL,
    "clubMemberId" TEXT NOT NULL,
    "clubId" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "fromStatus" "ClubMemberStatus",
    "toStatus" "ClubMemberStatus",
    "fromCategoryId" TEXT,
    "toCategoryId" TEXT,
    "reason" TEXT,
    "changedByUserId" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClubMemberHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserVerificationCode_userId_purpose_consumedAt_idx" ON "UserVerificationCode"("userId", "purpose", "consumedAt");

-- CreateIndex
CREATE INDEX "UserVerificationCode_expiresAt_idx" ON "UserVerificationCode"("expiresAt");

-- CreateIndex
CREATE INDEX "MemberCategory_clubId_isActive_idx" ON "MemberCategory"("clubId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "MemberCategory_clubId_code_key" ON "MemberCategory"("clubId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ClubMember_clientId_key" ON "ClubMember"("clientId");

-- CreateIndex
CREATE INDEX "ClubMember_clubId_status_idx" ON "ClubMember"("clubId", "status");

-- CreateIndex
CREATE INDEX "ClubMember_clubId_categoryId_idx" ON "ClubMember"("clubId", "categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "ClubMember_clubId_memberNumber_key" ON "ClubMember"("clubId", "memberNumber");

-- CreateIndex
CREATE INDEX "ClubMemberHistory_clubMemberId_createdAt_idx" ON "ClubMemberHistory"("clubMemberId", "createdAt");

-- CreateIndex
CREATE INDEX "ClubMemberHistory_clubId_createdAt_idx" ON "ClubMemberHistory"("clubId", "createdAt");

-- Normalizar DNI existentes (solo dígitos, 6 a 9) antes de volverlos únicos.
-- Si quedan duplicados, el índice falla a propósito: correr `npm run users:dni:audit`
-- y resolver los duplicados a mano antes de desplegar.
UPDATE "User" SET "dni" = NULLIF(regexp_replace("dni", '\D', '', 'g'), '') WHERE "dni" IS NOT NULL;
UPDATE "User" SET "dni" = NULL WHERE "dni" IS NOT NULL AND (length("dni") < 6 OR length("dni") > 9);

-- CreateIndex
CREATE UNIQUE INDEX "User_dni_key" ON "User"("dni");

-- AddForeignKey
ALTER TABLE "UserVerificationCode" ADD CONSTRAINT "UserVerificationCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberCategory" ADD CONSTRAINT "MemberCategory_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubMember" ADD CONSTRAINT "ClubMember_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubMember" ADD CONSTRAINT "ClubMember_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubMember" ADD CONSTRAINT "ClubMember_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "MemberCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubMemberHistory" ADD CONSTRAINT "ClubMemberHistory_clubMemberId_fkey" FOREIGN KEY ("clubMemberId") REFERENCES "ClubMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

