-- CreateTable
CREATE TABLE "producer_staff_invite_deliveries" (
    "id" SERIAL NOT NULL,
    "inviteId" INTEGER NOT NULL,
    "channel" VARCHAR(32) NOT NULL,
    "to" VARCHAR(255) NOT NULL,
    "provider" VARCHAR(64),
    "status" VARCHAR(32) NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "messageId" VARCHAR(255),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "producer_staff_invite_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "producer_staff_invite_deliveries_inviteId_idx" ON "producer_staff_invite_deliveries"("inviteId");

-- CreateIndex
CREATE INDEX "producer_staff_invite_deliveries_status_idx" ON "producer_staff_invite_deliveries"("status");

-- AddForeignKey
ALTER TABLE "producer_staff_invite_deliveries" ADD CONSTRAINT "producer_staff_invite_deliveries_inviteId_fkey" FOREIGN KEY ("inviteId") REFERENCES "producer_staff_invites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
