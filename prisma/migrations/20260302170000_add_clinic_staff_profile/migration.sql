-- CreateTable
CREATE TABLE "clinic_staff_profiles" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "branchMemberId" INTEGER NOT NULL,
    "staffType" VARCHAR(32) NOT NULL,
    "licenseNumber" VARCHAR(64),
    "specializationTags" JSONB,
    "defaultConsultationFee" DECIMAL(12,2),
    "visiting" BOOLEAN NOT NULL DEFAULT false,
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinic_staff_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "clinic_staff_profiles_branchMemberId_key" ON "clinic_staff_profiles"("branchMemberId");

-- CreateIndex
CREATE INDEX "clinic_staff_profiles_orgId_branchId_idx" ON "clinic_staff_profiles"("orgId", "branchId");

-- CreateIndex
CREATE INDEX "clinic_staff_profiles_branchId_staffType_idx" ON "clinic_staff_profiles"("branchId", "staffType");

-- AddForeignKey
ALTER TABLE "clinic_staff_profiles" ADD CONSTRAINT "clinic_staff_profiles_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_staff_profiles" ADD CONSTRAINT "clinic_staff_profiles_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_staff_profiles" ADD CONSTRAINT "clinic_staff_profiles_branchMemberId_fkey" FOREIGN KEY ("branchMemberId") REFERENCES "branch_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
