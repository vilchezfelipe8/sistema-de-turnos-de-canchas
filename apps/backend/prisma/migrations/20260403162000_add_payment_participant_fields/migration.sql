-- AlterTable
ALTER TABLE "Payment"
ADD COLUMN "payerParticipantRef" VARCHAR(191),
ADD COLUMN "payerParticipantName" VARCHAR(120),
ADD COLUMN "coveredParticipantRef" VARCHAR(191),
ADD COLUMN "coveredParticipantName" VARCHAR(120);

-- CreateIndex
CREATE INDEX "Payment_payerParticipantRef_idx" ON "Payment"("payerParticipantRef");

-- CreateIndex
CREATE INDEX "Payment_coveredParticipantRef_idx" ON "Payment"("coveredParticipantRef");
