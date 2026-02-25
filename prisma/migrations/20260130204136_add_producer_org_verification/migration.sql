/*
  Warnings:

  - A unique constraint covering the columns `[idempotencyKey]` on the table `donations` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
ALTER TYPE "VerificationEntityType" ADD VALUE 'PRODUCER_ORG';

-- CreateTable
CREATE TABLE "producer_org_staff" (
    "id" SERIAL NOT NULL,
    "producerOrgId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "roleId" INTEGER NOT NULL,
    "invitedBy" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "producer_org_staff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "producer_org_staff_userId_idx" ON "producer_org_staff"("userId");

-- CreateIndex
CREATE INDEX "producer_org_staff_roleId_idx" ON "producer_org_staff"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "producer_org_staff_producerOrgId_userId_key" ON "producer_org_staff"("producerOrgId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "donations_idempotencyKey_key" ON "donations"("idempotencyKey");

-- AddForeignKey
ALTER TABLE "producer_org_staff" ADD CONSTRAINT "producer_org_staff_producerOrgId_fkey" FOREIGN KEY ("producerOrgId") REFERENCES "producer_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "producer_org_staff" ADD CONSTRAINT "producer_org_staff_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "producer_org_staff" ADD CONSTRAINT "producer_org_staff_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "producer_org_staff" ADD CONSTRAINT "producer_org_staff_invitedBy_fkey" FOREIGN KEY ("invitedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
