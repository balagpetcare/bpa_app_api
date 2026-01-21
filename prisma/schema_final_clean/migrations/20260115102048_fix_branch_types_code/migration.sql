/*
  Warnings:

  - You are about to drop the column `description` on the `branch_types` table. All the data in the column will be lost.
  - Changed the type of `code` on the `branch_types` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- AlterTable
ALTER TABLE "branch_types" DROP COLUMN "description",
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0,
DROP COLUMN "code",
ADD COLUMN     "code" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "BranchTypeOnBranch" (
    "branchId" INTEGER NOT NULL,
    "branchTypeId" INTEGER NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BranchTypeOnBranch_pkey" PRIMARY KEY ("branchId","branchTypeId")
);

-- CreateIndex
CREATE INDEX "BranchTypeOnBranch_branchTypeId_idx" ON "BranchTypeOnBranch"("branchTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "branch_types_code_key" ON "branch_types"("code");

-- AddForeignKey
ALTER TABLE "BranchTypeOnBranch" ADD CONSTRAINT "BranchTypeOnBranch_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchTypeOnBranch" ADD CONSTRAINT "BranchTypeOnBranch_branchTypeId_fkey" FOREIGN KEY ("branchTypeId") REFERENCES "branch_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;
