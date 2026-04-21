-- CreateEnum
CREATE TYPE "AuthSessionStatus" AS ENUM ('ACTIVE', 'ROTATED', 'REVOKED', 'EXPIRED');

-- CreateTable
CREATE TABLE "AuthSession" (
  "id" TEXT NOT NULL,
  "userId" INTEGER NOT NULL,
  "refreshTokenHash" TEXT NOT NULL,
  "familyId" TEXT NOT NULL,
  "parentSessionId" TEXT,
  "status" "AuthSessionStatus" NOT NULL DEFAULT 'ACTIVE',
  "ip" TEXT,
  "userAgent" TEXT,
  "deviceLabel" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "rotatedAt" TIMESTAMPTZ(3),
  "revokedAt" TIMESTAMPTZ(3),
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "absoluteExpiresAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AuthSession_refreshTokenHash_key" ON "AuthSession"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "AuthSession_userId_status_idx" ON "AuthSession"("userId", "status");

-- CreateIndex
CREATE INDEX "AuthSession_familyId_idx" ON "AuthSession"("familyId");

-- CreateIndex
CREATE INDEX "AuthSession_expiresAt_idx" ON "AuthSession"("expiresAt");

-- AddForeignKey
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
