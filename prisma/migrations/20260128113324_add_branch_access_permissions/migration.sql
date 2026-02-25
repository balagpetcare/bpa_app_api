-- CreateEnum
CREATE TYPE "BranchAccessPermissionStatus" AS ENUM ('PENDING', 'APPROVED', 'REVOKED', 'EXPIRED');

-- AlterEnum (add new notification types)
ALTER TYPE "NotificationType" ADD VALUE 'STAFF_BRANCH_ACCESS_REQUEST';
ALTER TYPE "NotificationType" ADD VALUE 'STAFF_BRANCH_ACCESS_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'STAFF_BRANCH_ACCESS_REVOKED';
ALTER TYPE "NotificationType" ADD VALUE 'STAFF_BRANCH_ACCESS_EXPIRED';

-- CreateTable
CREATE TABLE "branch_access_permissions" (
    "id" SERIAL NOT NULL,
    "branchId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "status" "BranchAccessPermissionStatus" NOT NULL DEFAULT 'PENDING',
    "approvedByUserId" INTEGER,
    "approvedAt" TIMESTAMP(3),
    "revokedByUserId" INTEGER,
    "revokedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branch_access_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "branch_access_permissions_branchId_userId_key" ON "branch_access_permissions"("branchId", "userId");

-- CreateIndex
CREATE INDEX "branch_access_permissions_userId_status_idx" ON "branch_access_permissions"("userId", "status");

-- CreateIndex
CREATE INDEX "branch_access_permissions_branchId_status_idx" ON "branch_access_permissions"("branchId", "status");

-- CreateIndex
CREATE INDEX "branch_access_permissions_status_expiresAt_idx" ON "branch_access_permissions"("status", "expiresAt");

-- AddForeignKey
ALTER TABLE "branch_access_permissions" ADD CONSTRAINT "branch_access_permissions_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_access_permissions" ADD CONSTRAINT "branch_access_permissions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_access_permissions" ADD CONSTRAINT "branch_access_permissions_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_access_permissions" ADD CONSTRAINT "branch_access_permissions_revokedByUserId_fkey" FOREIGN KEY ("revokedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
