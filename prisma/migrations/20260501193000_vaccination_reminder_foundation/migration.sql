-- CreateEnum
CREATE TYPE "VaccinationReminderStage" AS ENUM ('SEVEN_DAYS_BEFORE', 'THREE_DAYS_BEFORE', 'DUE_DATE', 'OVERDUE');

-- CreateEnum
CREATE TYPE "VaccinationReminderChannel" AS ENUM ('IN_APP', 'SMS', 'EMAIL', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "VaccinationReminderStatus" AS ENUM ('PENDING', 'SENT', 'SKIPPED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "vaccination_reminders" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "vaccinationId" INTEGER NOT NULL,
    "petId" INTEGER NOT NULL,
    "ownerUserId" INTEGER,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "dueDateSnapshot" TIMESTAMP(3) NOT NULL,
    "stage" "VaccinationReminderStage" NOT NULL,
    "channel" "VaccinationReminderChannel" NOT NULL,
    "status" "VaccinationReminderStatus" NOT NULL DEFAULT 'PENDING',
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "notificationId" INTEGER,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "idempotencyKey" VARCHAR(191) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vaccination_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vaccination_reminders_idempotencyKey_key" ON "vaccination_reminders"("idempotencyKey");

-- CreateIndex
CREATE INDEX "vaccination_reminders_branchId_status_scheduledFor_idx" ON "vaccination_reminders"("branchId", "status", "scheduledFor");

-- CreateIndex
CREATE INDEX "vaccination_reminders_vaccinationId_idx" ON "vaccination_reminders"("vaccinationId");

-- CreateIndex
CREATE INDEX "vaccination_reminders_petId_idx" ON "vaccination_reminders"("petId");

-- CreateIndex
CREATE INDEX "vaccination_reminders_dueDate_idx" ON "vaccination_reminders"("dueDate");

-- AddForeignKey
ALTER TABLE "vaccination_reminders" ADD CONSTRAINT "vaccination_reminders_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vaccination_reminders" ADD CONSTRAINT "vaccination_reminders_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vaccination_reminders" ADD CONSTRAINT "vaccination_reminders_vaccinationId_fkey" FOREIGN KEY ("vaccinationId") REFERENCES "vaccinations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vaccination_reminders" ADD CONSTRAINT "vaccination_reminders_petId_fkey" FOREIGN KEY ("petId") REFERENCES "pets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vaccination_reminders" ADD CONSTRAINT "vaccination_reminders_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE SET NULL ON UPDATE CASCADE;
