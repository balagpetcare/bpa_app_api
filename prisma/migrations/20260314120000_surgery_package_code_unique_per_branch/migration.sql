-- Drop global unique on packageCode so the same code can exist in different branches.
DROP INDEX IF EXISTS "surgery_packages_packageCode_key";

-- Enforce unique packageCode per branch.
CREATE UNIQUE INDEX "surgery_packages_branchId_packageCode_key" ON "surgery_packages"("branchId", "packageCode");
