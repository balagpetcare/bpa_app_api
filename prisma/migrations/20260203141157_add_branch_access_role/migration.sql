-- AlterEnum
ALTER TYPE "BranchAccessPermissionStatus" ADD VALUE 'SUSPENDED';

-- AlterTable
ALTER TABLE "branch_access_permissions" ADD COLUMN     "note" TEXT,
ADD COLUMN     "requestedByUserId" INTEGER,
ADD COLUMN     "role" "MemberRole";

-- AddForeignKey
ALTER TABLE "branch_access_permissions" ADD CONSTRAINT "branch_access_permissions_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
