-- AlterTable
ALTER TABLE "User"
ADD COLUMN "emailVerifiedAt" TIMESTAMPTZ(3),
ADD COLUMN "lastLoginAt" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "MagicLoginToken" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "consumedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ip" TEXT,
  "userAgent" TEXT,

  CONSTRAINT "MagicLoginToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MagicLoginToken_tokenHash_key" ON "MagicLoginToken"("tokenHash");

-- CreateIndex
CREATE INDEX "MagicLoginToken_email_idx" ON "MagicLoginToken"("email");

-- CreateIndex
CREATE INDEX "MagicLoginToken_expiresAt_idx" ON "MagicLoginToken"("expiresAt");
