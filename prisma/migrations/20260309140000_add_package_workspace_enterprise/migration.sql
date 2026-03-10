-- AlterTable: surgery_packages - add enterprise package workspace fields
ALTER TABLE "surgery_packages" ADD COLUMN "eligibilityRuleJson" JSONB;
ALTER TABLE "surgery_packages" ADD COLUMN "availabilityRuleJson" JSONB;
ALTER TABLE "surgery_packages" ADD COLUMN "minSellingPrice" DECIMAL(12,2);
ALTER TABLE "surgery_packages" ADD COLUMN "maxDiscountPct" DECIMAL(5,2);
ALTER TABLE "surgery_packages" ADD COLUMN "maxDiscountAmount" DECIMAL(12,2);
ALTER TABLE "surgery_packages" ADD COLUMN "taxApplicable" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "surgery_packages" ADD COLUMN "branchOverrideAllowed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "surgery_packages" ADD COLUMN "description" TEXT;
ALTER TABLE "surgery_packages" ADD COLUMN "publicDescription" TEXT;
ALTER TABLE "surgery_packages" ADD COLUMN "internalNotes" TEXT;
ALTER TABLE "surgery_packages" ADD COLUMN "department" VARCHAR(64);
ALTER TABLE "surgery_packages" ADD COLUMN "breedNote" VARCHAR(256);
ALTER TABLE "surgery_packages" ADD COLUMN "updatedByUserId" INTEGER;
ALTER TABLE "surgery_packages" ADD COLUMN "effectiveFrom" DATE;
ALTER TABLE "surgery_packages" ADD COLUMN "effectiveTo" DATE;

-- CreateTable: package_audit_logs
CREATE TABLE "package_audit_logs" (
    "id" SERIAL NOT NULL,
    "surgeryPackageId" INTEGER NOT NULL,
    "action" VARCHAR(32) NOT NULL,
    "userId" INTEGER,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "package_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "package_audit_logs_surgeryPackageId_idx" ON "package_audit_logs"("surgeryPackageId");
CREATE INDEX "package_audit_logs_createdAt_idx" ON "package_audit_logs"("createdAt");

ALTER TABLE "surgery_packages" ADD CONSTRAINT "surgery_packages_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "package_audit_logs" ADD CONSTRAINT "package_audit_logs_surgeryPackageId_fkey" FOREIGN KEY ("surgeryPackageId") REFERENCES "surgery_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "package_audit_logs" ADD CONSTRAINT "package_audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "surgery_packages_status_idx" ON "surgery_packages"("status");
