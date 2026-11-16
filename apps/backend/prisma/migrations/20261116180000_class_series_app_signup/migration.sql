-- CreateEnum
CREATE TYPE "ClassSeriesMemberStatus" AS ENUM ('PENDING', 'ACTIVE', 'REJECTED');

-- AlterTable
ALTER TABLE "ClassSeries" ADD COLUMN     "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "visibility" "ClassSessionVisibility" NOT NULL DEFAULT 'PRIVATE';

-- AlterTable
ALTER TABLE "ClassSeriesMember" ADD COLUMN     "requestedByUserId" INTEGER,
ADD COLUMN     "status" "ClassSeriesMemberStatus" NOT NULL DEFAULT 'ACTIVE';

