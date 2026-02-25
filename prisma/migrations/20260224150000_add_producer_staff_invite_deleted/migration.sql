-- AlterEnum: add DELETED to ProducerStaffInviteStatus
ALTER TYPE "ProducerStaffInviteStatus" ADD VALUE 'DELETED';

-- AlterTable: add deletedAt, deletedByUserId to producer_staff_invites
ALTER TABLE "producer_staff_invites" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "producer_staff_invites" ADD COLUMN "deletedByUserId" INTEGER;
