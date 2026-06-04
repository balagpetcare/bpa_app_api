-- Add invitedByUserId for staff invite accept / audit (nullable; existing rows unchanged).

ALTER TABLE "branch_access_permissions" ADD COLUMN "invitedByUserId" INTEGER;

ALTER TABLE "branch_access_permissions" ADD CONSTRAINT "branch_access_permissions_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
