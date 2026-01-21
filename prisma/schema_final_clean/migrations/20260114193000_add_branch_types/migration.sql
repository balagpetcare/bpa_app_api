-- CreateEnum
CREATE TYPE "BranchTypeCode" AS ENUM (
  'CLINIC',
  'PET_SHOP',
  'DELIVERY_HUB',
  'WAREHOUSE_DC',
  'GROOMING_SPA',
  'BOARDING_DAYCARE',
  'FOSTER_SHELTER',
  'TRAINING_BEHAVIOR',
  'PHARMACY_DIAGNOSTICS'
);

-- CreateTable
CREATE TABLE "branch_types" (
  "id" SERIAL NOT NULL,
  "code" "BranchTypeCode" NOT NULL,
  "nameEn" TEXT NOT NULL,
  "nameBn" TEXT,
  "description" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "branch_types_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "branch_types_code_key" ON "branch_types"("code");

-- CreateTable
CREATE TABLE "branch_to_types" (
  "branchId" INTEGER NOT NULL,
  "typeId" INTEGER NOT NULL,

  CONSTRAINT "branch_to_types_pkey" PRIMARY KEY ("branchId","typeId")
);

-- CreateIndex
CREATE INDEX "branch_to_types_typeId_idx" ON "branch_to_types"("typeId");

-- AddForeignKey
ALTER TABLE "branch_to_types" ADD CONSTRAINT "branch_to_types_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_to_types" ADD CONSTRAINT "branch_to_types_typeId_fkey"
  FOREIGN KEY ("typeId") REFERENCES "branch_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;
