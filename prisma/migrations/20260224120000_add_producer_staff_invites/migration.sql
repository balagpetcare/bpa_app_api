-- CreateEnum
CREATE TYPE "ProducerStaffInviteStatus" AS ENUM ('PENDING', 'SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CANCELLED');

-- CreateTable
CREATE TABLE "producer_staff_invites" (
    "id" SERIAL NOT NULL,
    "producerOrgId" INTEGER NOT NULL,
    "invitedByUserId" INTEGER NOT NULL,
    "email" VARCHAR(255),
    "phone" VARCHAR(255),
    "roleId" INTEGER NOT NULL,
    "status" "ProducerStaffInviteStatus" NOT NULL DEFAULT 'PENDING',
    "tokenHash" VARCHAR(255),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "producer_staff_invites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "producer_staff_invite_producer_org_email_unique" ON "producer_staff_invites"("producerOrgId", "email");
CREATE UNIQUE INDEX "producer_staff_invite_producer_org_phone_unique" ON "producer_staff_invites"("producerOrgId", "phone");
CREATE INDEX "producer_staff_invites_producerOrgId_status_idx" ON "producer_staff_invites"("producerOrgId", "status");
CREATE INDEX "producer_staff_invites_email_idx" ON "producer_staff_invites"("email");
CREATE INDEX "producer_staff_invites_phone_idx" ON "producer_staff_invites"("phone");
CREATE INDEX "producer_staff_invites_expiresAt_idx" ON "producer_staff_invites"("expiresAt");

-- AddForeignKey
ALTER TABLE "producer_staff_invites" ADD CONSTRAINT "producer_staff_invites_producerOrgId_fkey" FOREIGN KEY ("producerOrgId") REFERENCES "producer_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "producer_staff_invites" ADD CONSTRAINT "producer_staff_invites_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "producer_staff_invites" ADD CONSTRAINT "producer_staff_invites_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "producer_staff_invites" ADD CONSTRAINT "producer_staff_invites_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
