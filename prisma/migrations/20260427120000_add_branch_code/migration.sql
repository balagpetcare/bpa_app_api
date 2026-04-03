-- AlterTable
ALTER TABLE "branches" ADD COLUMN "code" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "branches_orgId_code_key" ON "branches"("orgId", "code");
