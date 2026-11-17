-- AlterTable
ALTER TABLE "ClassPass" ADD COLUMN     "coversMonth" TEXT,
ADD COLUMN     "seriesMemberId" TEXT;

-- CreateIndex
CREATE INDEX "ClassPass_seriesMemberId_coversMonth_idx" ON "ClassPass"("seriesMemberId", "coversMonth");

-- AddForeignKey
ALTER TABLE "ClassPass" ADD CONSTRAINT "ClassPass_seriesMemberId_fkey" FOREIGN KEY ("seriesMemberId") REFERENCES "ClassSeriesMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

