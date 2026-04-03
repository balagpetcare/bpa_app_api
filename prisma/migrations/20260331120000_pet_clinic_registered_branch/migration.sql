-- AlterTable: branch-scoped clinic registration for pets (visibility without appointment yet)
ALTER TABLE "pets" ADD COLUMN "clinicRegisteredBranchId" INTEGER;

CREATE INDEX "pets_clinicRegisteredBranchId_idx" ON "pets"("clinicRegisteredBranchId");

ALTER TABLE "pets" ADD CONSTRAINT "pets_clinicRegisteredBranchId_fkey" FOREIGN KEY ("clinicRegisteredBranchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
