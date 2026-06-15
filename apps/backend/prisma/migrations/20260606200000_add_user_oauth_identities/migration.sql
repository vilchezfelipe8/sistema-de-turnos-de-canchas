-- CreateEnum
CREATE TYPE "UserOAuthProvider" AS ENUM ('GOOGLE', 'APPLE', 'FACEBOOK');

-- CreateTable
CREATE TABLE "UserOAuthIdentity" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "provider" "UserOAuthProvider" NOT NULL,
    "providerUserId" TEXT NOT NULL,
    "providerEmail" TEXT,
    "providerEmailVerified" BOOLEAN NOT NULL DEFAULT false,
    "profilePhotoUrl" TEXT,
    "linkedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserOAuthIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserOAuthIdentity_provider_providerUserId_key" ON "UserOAuthIdentity"("provider", "providerUserId");

-- CreateIndex
CREATE INDEX "UserOAuthIdentity_userId_idx" ON "UserOAuthIdentity"("userId");

-- AddForeignKey
ALTER TABLE "UserOAuthIdentity" ADD CONSTRAINT "UserOAuthIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
